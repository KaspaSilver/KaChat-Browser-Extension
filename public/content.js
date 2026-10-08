// KaChat Wallet's bridge between a web page and the extension (the content script's isolated
// world). It passes window.kachat calls to the background, which knows - from the browser, not
// from the page - which site is asking, and it tells the page when its connection changes.
(() => {
  const CHANNEL = "kachat-wallet";
  // `chrome` first: recent Chromium's separate `browser` namespace drops sendResponse answers.
  const api = globalThis.chrome?.runtime ? globalThis.chrome : globalThis.browser;
  const origin = window.location.origin;

  const toPage = (message) => window.postMessage({ channel: CHANNEL, direction: "to-page", ...message }, origin);

  window.addEventListener("message", (event) => {
    const data = event.data;
    // Only the page itself - never a frame posting into it.
    if (event.source !== window || !data || data.channel !== CHANNEL || data.direction !== "to-content") return;
    if (typeof data.id !== "string" || typeof data.method !== "string") return;
    const params = Array.isArray(data.params) ? data.params.slice(0, 4) : [];
    let reply;
    try {
      reply = api.runtime.sendMessage({ type: "dapp-request", method: data.method, params });
    } catch {
      toPage({ id: data.id, error: { code: 4900, message: "KaChat Wallet was updated - reload this page." } });
      return;
    }
    Promise.resolve(reply)
      .then((response) => toPage({ id: data.id, ...(response || { error: { code: 4900, message: "KaChat Wallet did not answer." } }) }))
      .catch(() => toPage({ id: data.id, error: { code: 4900, message: "KaChat Wallet is unavailable. Reload this page." } }));
  });

  // Connecting, disconnecting, switching account or network: the background worker tells this
  // tab (it only messages tabs of the origin concerned). This script never reads the wallet's
  // storage - it can't: storage is limited to the extension's own pages (audit EXT-006).
  const EVENTS = new Set(["accountsChanged", "disconnect", "networkChanged"]);
  // Introduces this tab to the background, which keeps which tabs show which site.
  const hello = () => { try { Promise.resolve(api.runtime.sendMessage({ type: "site-hello" })).catch(() => {}); } catch { /* reloaded */ } };
  hello();
  // a tab restored from the back/forward cache, or shown again, says hello again so the wallet
  // still knows it (audit EXT-009)
  addEventListener("pageshow", (event) => { if (event.persisted) hello(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") hello(); });
  api.runtime.onMessage.addListener((message, sender) => {
    if (sender?.id !== api.runtime.id || message?.type !== "kachat-site-event") return false;
    if (message.origin !== origin || !EVENTS.has(message.event)) return false;
    toPage({ event: message.event, payload: message.payload ?? null });
    return false;
  });
})();
