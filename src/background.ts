import { DEFAULT_CONFIG, STORAGE_KEY, coerceConfig } from "./config";

const INJECT_MESSAGE_TYPE = "react-grab-extension:inject";

const lastInjectAtByFrame = new Map<string, number>();

const ensureDefaultConfig = async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const current = stored[STORAGE_KEY];
  if (!current) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_CONFIG });
    return;
  }
  const coerced = coerceConfig(current);
  await chrome.storage.local.set({ [STORAGE_KEY]: coerced });
};

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultConfig();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;

  const msg = message as { type?: string } | null;
  if (!msg || msg.type !== INJECT_MESSAGE_TYPE) return;
  if (typeof tabId !== "number") return;

  const key = `${tabId}:${frameId}`;
  const now = Date.now();
  const last = lastInjectAtByFrame.get(key);
  if (typeof last === "number" && now - last < 500) {
    sendResponse({ ok: true, skipped: true });
    return;
  }
  lastInjectAtByFrame.set(key, now);

  chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["inject.js"],
      world: "MAIN",
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => {
      const messageText =
        error instanceof Error ? error.message : "Unknown error";
      sendResponse({ ok: false, error: messageText });
    });

  return true;
});
