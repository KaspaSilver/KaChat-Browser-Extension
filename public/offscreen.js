// The offscreen page the background worker opens to clear the clipboard 30 s after a recovery
// phrase or private key was copied (audit EXT-003). An offscreen page can't take focus, so it
// clears through a copy command whose copy event puts an empty string on the clipboard.
const api = globalThis.chrome?.runtime ? globalThis.chrome : globalThis.browser;

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "offscreen-clear-clipboard") return false;
  const onCopy = (event) => {
    event.clipboardData.setData("text/plain", "");
    event.preventDefault();
  };
  document.addEventListener("copy", onCopy);
  try { document.execCommand("copy"); } finally { document.removeEventListener("copy", onCopy); }
  sendResponse({ cleared: true });
  return false;
});
