import { DEFAULT_CONFIG, STORAGE_KEY, coerceConfig } from "./config";
import type { ExtensionConfig } from "./config";

const getEl = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
};

const agentServerUrlEl = getEl<HTMLInputElement>("agentServerUrl");
const agentHealthDotEl = getEl<HTMLSpanElement>("agentHealthDot");
const agentHealthTextEl = getEl<HTMLSpanElement>("agentHealthText");
const testAgentEl = getEl<HTMLButtonElement>("testAgent");

const loadConfig = async (): Promise<ExtensionConfig> => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return coerceConfig(stored[STORAGE_KEY] ?? DEFAULT_CONFIG);
};

const saveConfig = async (config: ExtensionConfig) => {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
};

const normalizeBaseUrl = (input: string): string => {
  const url = new URL(input);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
};

const setAgentHealthUi = (state: "unknown" | "ok" | "bad", text: string) => {
  agentHealthDotEl.classList.remove("ok", "bad");
  if (state === "ok") agentHealthDotEl.classList.add("ok");
  if (state === "bad") agentHealthDotEl.classList.add("bad");
  agentHealthTextEl.textContent = text;
};

let currentConfig: ExtensionConfig = DEFAULT_CONFIG;

const applyConfigToForm = (config: ExtensionConfig) => {
  agentServerUrlEl.value = config.agent.serverUrl;
  setAgentHealthUi("unknown", "未检测");
};

const persist = async () => {
  const coerced = coerceConfig(currentConfig);
  currentConfig = coerced;
  await saveConfig(coerced);
};

const testAgentHealth = async () => {
  setAgentHealthUi("unknown", "检测中…");
  try {
    const baseUrl = normalizeBaseUrl(agentServerUrlEl.value.trim());
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      cache: "no-store",
    });
    if (response.ok) {
      setAgentHealthUi("ok", "已连接");
    } else {
      setAgentHealthUi("bad", "不可用");
    }
  } catch {
    setAgentHealthUi("bad", "不可用");
  }
};

agentServerUrlEl.addEventListener("change", () => {
  currentConfig = {
    ...currentConfig,
    agent: { ...currentConfig.agent, serverUrl: agentServerUrlEl.value },
  };
  setAgentHealthUi("unknown", "未检测");
  void persist();
});

agentServerUrlEl.addEventListener("blur", () => {
  currentConfig = {
    ...currentConfig,
    agent: { ...currentConfig.agent, serverUrl: agentServerUrlEl.value },
  };
  void persist();
});

testAgentEl.addEventListener("click", () => {
  void testAgentHealth();
});

void (async () => {
  try {
    const config = await loadConfig();
    currentConfig = config;
    applyConfigToForm(config);
    void testAgentHealth();
  } catch (error) {
    void error;
    setAgentHealthUi("bad", "加载失败");
  }
})();
