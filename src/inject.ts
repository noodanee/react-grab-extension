import { init } from "react-grab/core";
import type {
  AgentContext,
  AgentProvider,
  AgentSession,
  AgentSessionStorage,
  ReactGrabAPI,
} from "react-grab/core";
import {
  CONFIG_ATTRIBUTE,
  CONFIG_EVENT,
  DEFAULT_CONFIG,
  coerceConfig,
} from "./config";
import type { ExtensionConfig } from "./config";

type GrabWindow = typeof window & {
  __reactGrabExtensionActive__?: boolean;
};

type PortRequest =
  | {
      type: "agent:run";
      requestId: string;
      serverUrl: string;
      context: unknown;
    }
  | {
      type: "agent:abort";
      requestId: string;
      serverUrl: string;
      sessionId?: string;
    }
  | {
      type: "agent:health";
      requestId: string;
      serverUrl: string;
    }
  | {
      type: "agent:undo";
      requestId: string;
      serverUrl: string;
    };

type PortResponse =
  | { type: "agent:status"; requestId: string; status: string }
  | { type: "agent:done"; requestId: string }
  | { type: "agent:error"; requestId: string; error: string }
  | { type: "agent:healthResult"; requestId: string; ok: boolean };

const CONNECT_MESSAGE_TYPE = "react-grab-extension:connect";

const grabWindow = window as GrabWindow;

const isReactGrabApi = (value: unknown): value is ReactGrabAPI => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "setAgent" in value &&
    "dispose" in value &&
    "activate" in value &&
    "deactivate" in value
  );
};

const createRequestId = () =>
  `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

let port: MessagePort | null = null;

const listenersByRequestId = new Map<string, (msg: PortResponse) => void>();

const ensurePort = (): MessagePort => {
  if (port) return port;

  const channel = new MessageChannel();
  port = channel.port1;
  port.onmessage = (event) => {
    const msg = event.data as PortResponse | null;
    if (!msg || typeof msg.requestId !== "string") return;
    const handler = listenersByRequestId.get(msg.requestId);
    if (handler) handler(msg);
  };

  if ("start" in port) {
    port.start();
  }

  window.postMessage({ type: CONNECT_MESSAGE_TYPE }, "*", [channel.port2]);
  return port;
};

const createStream = (requestId: string) => {
  const queue: PortResponse[] = [];
  let resolveNext: ((msg: PortResponse) => void) | null = null;

  const push = (msg: PortResponse) => {
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve(msg);
      return;
    }
    queue.push(msg);
  };

  const next = (): Promise<PortResponse> => {
    const item = queue.shift();
    if (item) return Promise.resolve(item);
    return new Promise((resolve) => {
      resolveNext = resolve;
    });
  };

  const close = () => {
    listenersByRequestId.delete(requestId);
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve({ type: "agent:done", requestId });
    }
  };

  listenersByRequestId.set(requestId, push);

  return { next, close };
};

const waitForResponse = <T extends PortResponse>(
  requestId: string,
  predicate: (msg: PortResponse) => msg is T,
  timeoutMs: number,
): Promise<T> => {
  ensurePort();

  return new Promise<T>((resolve, reject) => {
    let timeoutId: number | null = null;

    const cleanup = () => {
      listenersByRequestId.delete(requestId);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };

    listenersByRequestId.set(requestId, (msg) => {
      if (!predicate(msg)) return;
      cleanup();
      resolve(msg);
    });

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timeout"));
    }, timeoutMs);
  });
};

const getStoredSessionContext = (
  storage: AgentSessionStorage,
  sessionId: string,
): AgentContext | null => {
  try {
    const raw = storage.getItem("react-grab:agent-sessions");
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, AgentSession>;
    const session = obj[sessionId];
    if (!session || !session.context) return null;
    return session.context;
  } catch {
    return null;
  }
};

const createAgentBridgeProvider = (serverUrl: string): AgentProvider => {
  const normalized = serverUrl.trim().replace(/\/+$/, "");

  return {
    send: async function* (context: AgentContext, signal: AbortSignal) {
      const p = ensurePort();
      const requestId = createRequestId();
      const stream = createStream(requestId);

      const sessionId = context.sessionId;
      signal.addEventListener(
        "abort",
        () => {
          const abortMsg: PortRequest = {
            type: "agent:abort",
            requestId,
            serverUrl: normalized,
            sessionId,
          };
          p.postMessage(abortMsg);
          stream.close();
        },
        { once: true },
      );

      const runMsg: PortRequest = {
        type: "agent:run",
        requestId,
        serverUrl: normalized,
        context,
      };
      p.postMessage(runMsg);

      try {
        while (true) {
          const msg = await stream.next();
          if (msg.type === "agent:status") {
            yield msg.status;
            continue;
          }
          if (msg.type === "agent:error") {
            throw new Error(msg.error);
          }
          if (msg.type === "agent:done") {
            break;
          }
        }
      } finally {
        stream.close();
      }
    },

    resume: async function* (
      sessionId: string,
      signal: AbortSignal,
      storage: AgentSessionStorage,
    ) {
      const storedContext = getStoredSessionContext(storage, sessionId);
      if (!storedContext) return;
      const context: AgentContext = {
        content: storedContext.content,
        prompt: storedContext.prompt,
        options: storedContext.options,
        sessionId: storedContext.sessionId ?? sessionId,
      };
      yield* this.send(context, signal);
    },

    supportsResume: true,
    supportsFollowUp: true,

    checkConnection: async () => {
      try {
        const p = ensurePort();
        const requestId = createRequestId();
        const msg: PortRequest = {
          type: "agent:health",
          requestId,
          serverUrl: normalized,
        };
        p.postMessage(msg);
        const result = await waitForResponse(
          requestId,
          (
            m,
          ): m is { type: "agent:healthResult"; requestId: string; ok: boolean } =>
            m.type === "agent:healthResult",
          2_000,
        );
        return Boolean(result.ok);
      } catch {
        return false;
      }
    },

    undo: async () => {
      const p = ensurePort();
      const requestId = createRequestId();
      const msg: PortRequest = {
        type: "agent:undo",
        requestId,
        serverUrl: normalized,
      };
      p.postMessage(msg);
    },
  };
};

let api: ReactGrabAPI | null = null;

const ensureApi = (): ReactGrabAPI => {
  if (api) return api;
  const existing = (window as unknown as { __REACT_GRAB__?: unknown })
    .__REACT_GRAB__;
  if (isReactGrabApi(existing)) {
    api = existing;
    return api;
  }
  api = init();
  return api;
};

const applyConfig = (config: ExtensionConfig) => {
  const apiInstance = ensureApi();
  const provider = createAgentBridgeProvider(config.agent.serverUrl);
  apiInstance.setAgent({ provider, storage: sessionStorage });
};

const readConfigFromDom = (): ExtensionConfig => {
  const raw = document.documentElement?.getAttribute(CONFIG_ATTRIBUTE);
  if (!raw) return DEFAULT_CONFIG;
  try {
    return coerceConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_CONFIG;
  }
};

let pendingConfig: ExtensionConfig = DEFAULT_CONFIG;
let isDomReady = document.readyState !== "loading";

const boot = () => {
  ensurePort();

  pendingConfig = readConfigFromDom();

  window.addEventListener(CONFIG_EVENT, (event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail;
    if (typeof detail !== "string") return;
    try {
      const parsed = JSON.parse(detail);
      pendingConfig = coerceConfig(parsed);
      if (isDomReady) {
        applyConfig(pendingConfig);
      }
    } catch {
      return;
    }
  });
};

if (!grabWindow.__reactGrabExtensionActive__) {
  grabWindow.__reactGrabExtensionActive__ = true;

  boot();

  if (!isDomReady) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        isDomReady = true;
        applyConfig(pendingConfig);
      },
      { once: true },
    );
  } else {
    applyConfig(pendingConfig);
  }
}
