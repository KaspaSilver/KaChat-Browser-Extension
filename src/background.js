// Background worker. The wallet itself runs in the popup and the full-tab view (they have the
// DOM, localStorage and a steady WebSocket); this worker does two small jobs: auto-lock, and
// the website-connect broker.
//
// Auto-lock: every interaction in the popup sends "activity", which re-arms a one-shot alarm
// for the user's auto-lock delay. When the alarm fires, the unlock key in storage.session is
// cleared, and the next time the popup opens it asks for the password. storage.session is also
// empty after a browser restart, so a restart always locks.
//
// Website connect: pages call window.kachat (public/inpage.js), the content script
// (public/content.js) forwards each call here, and this worker - which learns the calling site
// from the browser (sender), never from the page - answers the harmless ones and sends the rest
// to an approval window (approve.js). The approval window does the signing and hands the answer
// back. Nothing is approved without the user seeing the site's origin.

import { ext } from "./browser.js";

const ALARM = "kachat.autolock";
const CLIPBOARD_ALARM = "kachat.clear-clipboard";
const SETTINGS_KEY = "kachat.settings";
const DEFAULT_AUTOLOCK_MINUTES = 15;

async function autoLockMinutes() {
  const settings = (await ext.storage.local.get(SETTINGS_KEY))?.[SETTINGS_KEY] || {};
  const minutes = Number(settings.autoLockMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_AUTOLOCK_MINUTES;
}

async function armAutoLock() {
  await ext.alarms.create(ALARM, { delayInMinutes: await autoLockMinutes() });
}

// Locking removes the unlock key only: the site-tab registry (also in storage.session) has to
// outlive a lock, or open dApp tabs stop hearing account and network events (audit EXT-009).
const UNLOCK_KEY = "kachat.unlockKey";

async function lockNow() {
  await ext.alarms.clear(ALARM);
  await ext.storage.session.remove(UNLOCK_KEY);
}
const NETWORK_MIRROR_KEY = "kachat.network"; // net.js mirrors the pages' choice here (no localStorage in a worker)

async function onTestnet() {
  return (await ext.storage.local.get(NETWORK_MIRROR_KEY))?.[NETWORK_MIRROR_KEY] === "testnet";
}
/** Connections are kept per network, like the pages' net.js netKey. */
async function connectionsKey() {
  return (await onTestnet()) ? "kachat.connections.testnet" : "kachat.connections";
}
const MAX_MESSAGE_LENGTH = 4096;

const rejected = () => ({ error: { code: 4001, message: "The request was rejected in KaChat Wallet." } });
// The approval window went away while it was sending an approved payment: it may have reached the
// network, so this is never "rejected" (audit EXT-012) - the site must check before asking again.
const maybeSent = () => ({ error: { code: 4002, message: "The payment may have been sent. Check your wallet before trying again." } });
const unauthorized = () => ({ error: { code: 4100, message: "Connect first: call kachat.requestAccounts()." } });
const invalid = (message) => ({ error: { code: -32602, message } });

/** Approvals waiting on the user: id -> { id, origin, kind, params, resolve, windowId }. */
const approvals = new Map();

async function connections() {
  return (await ext.storage.local.get(await connectionsKey()))?.[await connectionsKey()] || {};
}

async function isUnlocked() {
  return Boolean((await ext.storage.session.get(UNLOCK_KEY))?.[UNLOCK_KEY]);
}

/** The calling site, from the browser's own record of the sender: top frame, http(s) only. */
function siteOrigin(sender) {
  if (sender?.id !== ext.runtime.id || !sender.tab) return null;
  if (sender.frameId != null && sender.frameId !== 0) return null;
  try {
    const url = new URL(sender.origin || sender.url);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

// The popup, the tab view and the approval window (which, being a window, has a tab too). A
// content script's sender URL is the website's, so it never passes.
function fromExtensionPage(sender) {
  return sender?.id === ext.runtime.id && String(sender.url || "").startsWith(ext.runtime.getURL(""));
}

async function restApi() {
  const settings = (await ext.storage.local.get(SETTINGS_KEY))?.[SETTINGS_KEY] || {};
  const testnet = await onTestnet();
  const configured = testnet ? settings.restApiTestnet : settings.restApi;
  return String(configured || (testnet ? "https://api-tn10.kaspa.org" : "https://api.kaspa.org")).replace(/\/+$/, "");
}

async function balanceOf(address) {
  const response = await fetch(`${await restApi()}/addresses/${encodeURIComponent(address)}/balance`, { headers: { Accept: "application/json" } });
  if (!response.ok) return { error: { code: 4900, message: `Balance unavailable (HTTP ${response.status}).` } };
  const json = await response.json();
  const total = Number(json?.balance ?? 0);
  return { result: { confirmed: total, unconfirmed: 0, total } };
}

async function openApproval(origin, kind, params) {
  for (const entry of approvals.values()) {
    if (entry.origin === origin) return { error: { code: -32002, message: "A request from this site is already waiting in KaChat Wallet." } };
  }
  const id = crypto.randomUUID();
  const entry = { id, origin, kind, params, createdAt: Date.now(), windowId: null };
  const answer = new Promise((resolve) => { entry.resolve = resolve; });
  approvals.set(id, entry);
  try {
    const win = await ext.windows.create({
      url: ext.runtime.getURL(`popup.html?view=approve&id=${encodeURIComponent(id)}`),
      type: "popup", width: 380, height: 640, focused: true,
    });
    entry.windowId = win?.id ?? null;
  } catch {
    approvals.delete(id);
    return { error: { code: 4900, message: "Couldn't open KaChat Wallet." } };
  }
  const result = await answer;
  approvals.delete(id);
  if (entry.windowId != null) ext.windows.remove(entry.windowId).catch(() => {});
  return result;
}

async function handleSiteRequest(method, params, origin) {
  let connection = (await connections())[origin] || null;
  // A connection to an account no longer in the vault is no connection (audit EXT-002).
  const accountIds = (await ext.storage.local.get("kachat.accountIds"))["kachat.accountIds"];
  if (connection && Array.isArray(accountIds) && !accountIds.includes(connection.accountId)) connection = null;
  const open = connection && (await isUnlocked());
  switch (method) {
    case "getNetwork":
      // Only a connected site learns the network (audit EXT-013): anyone else could fingerprint it.
      return { result: connection ? ((await onTestnet()) ? "testnet-10" : "mainnet") : null };
    case "getAccounts":
      return { result: open ? [connection.address] : [] };
    case "requestAccounts":
      if (open) return { result: [connection.address] };
      return openApproval(origin, "connect", []);
    case "getPublicKey":
      return open ? { result: connection.publicKey } : unauthorized();
    case "getBalance":
      return open ? balanceOf(connection.address) : unauthorized();
    case "disconnect": {
      if (connection) {
        const all = await connections();
        delete all[origin];
        await ext.storage.local.set({ [await connectionsKey()]: all });
      }
      return { result: true };
    }
    case "sendKaspa": {
      if (!connection) return unauthorized();
      const [to, sompi, options] = params;
      const prefix = (await onTestnet()) ? "kaspatest:" : "kaspa:";
      if (typeof to !== "string" || !to.trim().toLowerCase().startsWith(prefix) || !/^[a-z]+:[a-z0-9]{50,90}$/.test(to.trim().toLowerCase())) return invalid(`sendKaspa: a ${prefix} address is required.`);
      if (!/^\d{1,19}$/.test(String(sompi)) || BigInt(sompi) <= 0n) return invalid("sendKaspa: the amount is a whole number of sompi above zero.");
      const priorityFee = String(options?.priorityFee ?? "0");
      if (!/^\d{1,15}$/.test(priorityFee)) return invalid("sendKaspa: priorityFee is a whole number of sompi.");
      return openApproval(origin, "sendKaspa", [to.trim().toLowerCase(), String(sompi), priorityFee]);
    }
    case "signMessage": {
      if (!connection) return unauthorized();
      const [message] = params;
      if (typeof message !== "string" || !message.length) return invalid("signMessage: the message is required.");
      if (message.length > MAX_MESSAGE_LENGTH) return invalid(`signMessage: messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
      return openApproval(origin, "signMessage", [message]);
    }
    default:
      return { error: { code: 4200, message: `KaChat Wallet does not support ${String(method).slice(0, 40)}.` } };
  }
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "activity": armAutoLock(); return false;
    case "clear-clipboard-soon": {
      // A recovery phrase or private key was copied: clear the clipboard in 30 s (audit EXT-003).
      if (!fromExtensionPage(sender) || !ext.offscreen?.createDocument) { sendResponse({ supported: false }); return false; }
      ext.alarms.create(CLIPBOARD_ALARM, { when: Date.now() + 30_000 });
      sendResponse({ supported: true });
      return false;
    }
    case "lock": lockNow(); return false;
    case "site-hello":
      rememberSiteTab(sender).catch(() => {});
      return false;
    case "dapp-request": {
      rememberSiteTab(sender).catch(() => {});
      const origin = siteOrigin(sender);
      if (!origin) { sendResponse({ error: { code: 4100, message: "Requests are only accepted from the page itself." } }); return false; }
      handleSiteRequest(String(message.method || ""), Array.isArray(message.params) ? message.params : [], origin)
        .then(sendResponse, () => sendResponse({ error: { code: 4900, message: "KaChat Wallet hit an error." } }));
      return true;
    }
    case "approval-get": {
      if (!fromExtensionPage(sender)) return false;
      const entry = approvals.get(message.id);
      sendResponse(entry ? { id: entry.id, origin: entry.origin, kind: entry.kind, params: entry.params } : null);
      return false;
    }
    case "approval-result": {
      if (!fromExtensionPage(sender)) return false;
      const entry = approvals.get(message.id);
      if (entry) entry.resolve(message.error ? (entry.sending ? maybeSent() : rejected()) : { result: message.result });
      return false;
    }
    case "approval-sending": {
      // An approved payment is being built and submitted from the approval window.
      if (!fromExtensionPage(sender)) return false;
      const entry = approvals.get(message.id);
      // (a send that failed before reaching the node clears it again)
      if (entry) entry.sending = message.sending !== false;
      return false;
    }
    case "approval-ping":
      // The approval window keeps this worker awake while the user decides.
      return false;
    default:
      return false;
  }
});

// Closing the approval window is a rejection - unless it was already sending an approved payment.
ext.windows?.onRemoved?.addListener((windowId) => {
  for (const entry of approvals.values()) if (entry.windowId === windowId) entry.resolve(entry.sending ? maybeSent() : rejected());
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) lockNow();
  if (alarm.name === CLIPBOARD_ALARM) clearClipboard();
});

/** Empties the clipboard from an offscreen page - it needs no focus and outlives the popup. It
 *  writes an empty string without reading first, so a copy made in the 30 s is cleared too. */
async function clearClipboard() {
  if (!ext.offscreen?.createDocument) return;
  try {
    await ext.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "Clears a copied recovery phrase or private key from the clipboard after 30 seconds.",
    });
  } catch { /* already open */ }
  try { await ext.runtime.sendMessage({ type: "offscreen-clear-clipboard" }); } catch { /* the page wasn't ready */ }
  try { await ext.offscreen.closeDocument(); } catch { /* already closed */ }
}

// --- Storage stays with the extension (audit EXT-006) ---------------------------------------
// Content scripts run inside web pages' processes, so they get no access to storage.local (the
// encrypted vault, connections, cached addresses, settings). Where the browser can't restrict it,
// the website script still never reads it.
function lockStorageToExtension() {
  try {
    const result = ext.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    result?.catch?.(() => {});
  } catch { /* not supported here */ }
}
lockStorageToExtension();
ext.runtime.onInstalled?.addListener(lockStorageToExtension);

// --- Telling sites what changed (audits EXT-006, EXT-007) -----------------------------------
// A site hears accountsChanged / disconnect when its connection changes, and networkChanged when
// the wallet switches networks - sent only to tabs of that site's origin.

// Which tabs show which site: each page's script says hello (and every request carries its tab);
// the origin comes from the browser, never the page. Kept in storage.session (extension-only).
const SITE_TABS_KEY = "kachat.siteTabs";

// Every change to the registry goes through one chain, so tabs saying hello together (a browser
// restore, several dApp tabs opened at once) never overwrite each other (audit EXT-009).
let siteTabsChain = Promise.resolve();
function updateSiteTabs(change) {
  siteTabsChain = siteTabsChain.then(async () => {
    const map = (await ext.storage.session.get(SITE_TABS_KEY))[SITE_TABS_KEY] || {};
    if (change(map) === false) return;
    await ext.storage.session.set({ [SITE_TABS_KEY]: map });
  }).catch(() => {});
  return siteTabsChain;
}

async function rememberSiteTab(sender) {
  const origin = siteOrigin(sender);
  const tabId = sender?.tab?.id;
  if (!origin || tabId == null) return;
  await updateSiteTabs((map) => {
    if (map[tabId] === origin) return false;
    map[tabId] = origin;
    return true;
  });
}

ext.tabs?.onRemoved?.addListener((tabId) => {
  updateSiteTabs((map) => {
    if (!(tabId in map)) return false;
    delete map[tabId];
    return true;
  });
});

async function tellSite(origin, event, payload) {
  const map = (await ext.storage.session.get(SITE_TABS_KEY))[SITE_TABS_KEY] || {};
  for (const [tabId, tabOrigin] of Object.entries(map)) {
    if (tabOrigin !== origin) continue;
    try {
      await ext.tabs.sendMessage(Number(tabId), { type: "kachat-site-event", origin, event, payload });
    } catch { /* the tab navigated away or closed */ }
  }
}

const CONNECTION_KEYS = { "kachat.connections": "mainnet", "kachat.connections.testnet": "testnet" };

ext.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  const testnet = await onTestnet();
  for (const [key, network] of Object.entries(CONNECTION_KEYS)) {
    // Only the network the wallet is on: the other one's sites aren't answered now.
    if (!changes[key] || (network === "testnet") !== testnet) continue;
    const before = changes[key].oldValue || {};
    const after = changes[key].newValue || {};
    for (const origin of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const was = before[origin]?.address || null;
      const now = after[origin]?.address || null;
      if (was === now) continue;
      if (now) tellSite(origin, "accountsChanged", [now]);
      else { tellSite(origin, "accountsChanged", []); tellSite(origin, "disconnect", null); }
    }
  }
  const networkChange = changes["kachat.network"];
  if (networkChange && networkChange.oldValue !== networkChange.newValue) {
    const nowTestnet = networkChange.newValue === "testnet";
    const all = await ext.storage.local.get(Object.keys(CONNECTION_KEYS));
    const current = all[nowTestnet ? "kachat.connections.testnet" : "kachat.connections"] || {};
    const origins = new Set([...Object.keys(all["kachat.connections"] || {}), ...Object.keys(all["kachat.connections.testnet"] || {})]);
    for (const origin of origins) {
      tellSite(origin, "networkChanged", nowTestnet ? "testnet-10" : "mainnet");
      const address = current[origin]?.address || null;
      if (address) tellSite(origin, "accountsChanged", [address]);
      else { tellSite(origin, "accountsChanged", []); tellSite(origin, "disconnect", null); }
    }
  }
});

// A browser restart already empties storage.session; this also clears a leftover alarm.
ext.runtime.onStartup?.addListener(() => { lockNow(); });
