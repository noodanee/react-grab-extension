export interface ExtensionConfig {
  agent: {
    serverUrl: string;
  };
}

export type PublicExtensionConfig = ExtensionConfig;

export const STORAGE_KEY = "react-grab-extension:config";
export const CONFIG_ATTRIBUTE = "data-react-grab-extension-config";
export const CONFIG_EVENT = "react-grab-extension:config";

export const DEFAULT_CONFIG: ExtensionConfig = {
  agent: {
    serverUrl: "http://localhost:7567",
  },
};

export const coerceConfig = (value: unknown): ExtensionConfig => {
  const raw = value as Partial<ExtensionConfig> | null;

  const agentServerUrl =
    raw?.agent?.serverUrl?.trim() || DEFAULT_CONFIG.agent.serverUrl;

  return {
    agent: { serverUrl: agentServerUrl },
  };
};
