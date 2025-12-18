import {
  CONFIG_ATTRIBUTE,
  CONFIG_EVENT,
  DEFAULT_CONFIG,
  STORAGE_KEY,
  coerceConfig,
} from "./config";
import type { ExtensionConfig } from "./config";

const INJECT_MESSAGE_TYPE = "react-grab-extension:inject";
const CONNECT_MESSAGE_TYPE = "react-grab-extension:connect";

const applyConfigToPage = (config: ExtensionConfig) => {
  const root = document.documentElement;
  if (!root) return;
  const serialized = JSON.stringify(config);
  root.setAttribute(CONFIG_ATTRIBUTE, serialized);
  window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: serialized }));
};

const loadConfig = async (): Promise<ExtensionConfig> => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return coerceConfig(stored[STORAGE_KEY] ?? DEFAULT_CONFIG);
};

const requestInject = () => {
  chrome.runtime.sendMessage({ type: INJECT_MESSAGE_TYPE }, () => {
    void chrome.runtime.lastError;
  });
};

const start = async () => {
  const config = await loadConfig();
  applyConfigToPage(config);
  requestInject();
};

void start();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const change = changes[STORAGE_KEY];
  if (!change) return;
  const next = coerceConfig(change.newValue ?? DEFAULT_CONFIG);
  applyConfigToPage(next);
  requestInject();
});

type AgentRunRequest = {
  type: "agent:run";
  requestId: string;
  serverUrl: string;
  context: unknown;
};

type AgentHealthRequest = {
  type: "agent:health";
  requestId: string;
  serverUrl: string;
};

type AgentUndoRequest = {
  type: "agent:undo";
  requestId: string;
  serverUrl: string;
};

type AgentAbortRequest = {
  type: "agent:abort";
  requestId: string;
  serverUrl: string;
  sessionId?: string;
};

type PortRequest =
  | AgentRunRequest
  | AgentHealthRequest
  | AgentUndoRequest
  | AgentAbortRequest;

type AgentStatusResponse = {
  type: "agent:status";
  requestId: string;
  status: string;
};

type AgentDoneResponse = {
  type: "agent:done";
  requestId: string;
};

type AgentErrorResponse = {
  type: "agent:error";
  requestId: string;
  error: string;
};

type AgentHealthResponse = {
  type: "agent:healthResult";
  requestId: string;
  ok: boolean;
};

type PortResponse =
  | AgentStatusResponse
  | AgentDoneResponse
  | AgentErrorResponse
  | AgentHealthResponse;

const normalizeBaseUrl = (input: string): string => {
  const url = new URL(input);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
};

const parseSse = async (
  response: Response,
  onEvent: (event: string, data: string) => void,
  signal: AbortSignal,
) => {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let currentEvent = "";
  let currentData = "";

  const flush = () => {
    if (!currentData) {
      currentEvent = "";
      return;
    }
    onEvent(currentEvent || "message", currentData);
    currentEvent = "";
    currentData = "";
  };

  while (true) {
    if (signal.aborted) break;
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) {
        flush();
        continue;
      }

      if (line.startsWith("event:")) {
        currentEvent = line.slice("event:".length).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        const chunk = line.slice("data:".length).trimStart();
        currentData = currentData ? `${currentData}\n${chunk}` : chunk;
      }
    }
  }
};

const agentAbortControllers = new Map<string, AbortController>();

let port: MessagePort | null = null;

const sendToPage = (message: PortResponse) => {
  port?.postMessage(message);
};

const handleAgentRun = async (req: AgentRunRequest) => {
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(req.serverUrl);
  } catch {
    sendToPage({
      type: "agent:error",
      requestId: req.requestId,
      error: "Invalid serverUrl",
    });
    return;
  }

  const controller = new AbortController();
  agentAbortControllers.set(req.requestId, controller);

  try {
    const response = await fetch(`${baseUrl}/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.context ?? {}),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      sendToPage({
        type: "agent:error",
        requestId: req.requestId,
        error: `HTTP ${response.status} ${text}`.trim(),
      });
      return;
    }

    await parseSse(
      response,
      (event, data) => {
        if (event === "error") {
          sendToPage({
            type: "agent:error",
            requestId: req.requestId,
            error: data || "Unknown error",
          });
          return;
        }
        if (event === "status" || event === "result") {
          sendToPage({
            type: "agent:status",
            requestId: req.requestId,
            status: data,
          });
        }
      },
      controller.signal,
    );
  } catch (error) {
    if (controller.signal.aborted) {
      sendToPage({ type: "agent:done", requestId: req.requestId });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    sendToPage({
      type: "agent:error",
      requestId: req.requestId,
      error: message,
    });
    return;
  } finally {
    agentAbortControllers.delete(req.requestId);
  }

  sendToPage({ type: "agent:done", requestId: req.requestId });
};

const handleAgentAbort = async (req: AgentAbortRequest) => {
  const controller = agentAbortControllers.get(req.requestId);
  if (controller) {
    controller.abort();
    agentAbortControllers.delete(req.requestId);
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(req.serverUrl);
  } catch {
    return;
  }

  const sessionId = req.sessionId?.trim();
  if (!sessionId) return;

  await fetch(`${baseUrl}/abort/${encodeURIComponent(sessionId)}`, {
    method: "POST",
  }).catch(() => null);
};

const handleAgentHealth = async (req: AgentHealthRequest) => {
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(req.serverUrl);
  } catch {
    sendToPage({
      type: "agent:healthResult",
      requestId: req.requestId,
      ok: false,
    });
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/health`, { method: "GET" });
    sendToPage({
      type: "agent:healthResult",
      requestId: req.requestId,
      ok: response.ok,
    });
  } catch {
    sendToPage({
      type: "agent:healthResult",
      requestId: req.requestId,
      ok: false,
    });
  }
};

const handleAgentUndo = async (req: AgentUndoRequest) => {
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(req.serverUrl);
  } catch {
    return;
  }

  await fetch(`${baseUrl}/undo`, { method: "POST" }).catch(() => null);
};

const handlePortRequest = (req: PortRequest) => {
  if (req.type === "agent:run") {
    void handleAgentRun(req);
    return;
  }
  if (req.type === "agent:abort") {
    void handleAgentAbort(req);
    return;
  }
  if (req.type === "agent:health") {
    void handleAgentHealth(req);
    return;
  }
  if (req.type === "agent:undo") {
    void handleAgentUndo(req);
    return;
  }
};

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { type?: string } | null;
  if (!data || data.type !== CONNECT_MESSAGE_TYPE) return;
  const nextPort = event.ports?.[0];
  if (!(nextPort instanceof MessagePort)) return;
  port = nextPort;
  port.onmessage = (messageEvent) => {
    const payload = messageEvent.data as PortRequest | null;
    if (!payload) return;
    handlePortRequest(payload);
  };
  if ("start" in port) {
    port.start();
  }
});
