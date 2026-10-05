// "Claim Testnet Kaspa" - iOS TestnetFaucetClaimButton (182ae68, 2a81767), on the Profile above
// the Chatting card, testnet only.
//
// The official TN10 faucet sits behind a Cloudflare check, so it isn't claimed in the background:
// the card copies the chatting address (its kaspatest: form) and opens the faucet in a tab, where
// you paste it, pass the check and claim the most it offers. The faucet allows one claim a day, so
// once the chatting balance goes up after a visit the card locks for 24 hours (kept per address).
//
// Opening a tab closes the toolbar popup, so the visit is remembered (`pending`) and the balance
// checked the next time the wallet opens; a wallet open in its own tab watches for a minute, as
// iOS does after the in-app browser closes.

import { esc, toast } from "./ui.js";
import { ext } from "./browser.js";

export const FAUCET_URL = "https://faucet-tn10.kaspanet.io";
const LOCK_MS = 24 * 60 * 60 * 1000;
/** How long after a visit a balance rise still counts as the faucet's payment. */
const PENDING_MS = 10 * 60 * 1000;
const PENDING_KEY = "kachat_tn10_faucet_pending";

const claimedKey = (address) => `kachat_tn10_faucet_claimed_${String(address).toLowerCase()}`;

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function write(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch { /* not kept */ }
}

/** When the address may claim again (ms), or null when it may now. */
export function faucetUnlockAt(address, now = Date.now()) {
  const at = Number(read(claimedKey(address)));
  if (!Number.isFinite(at) || !at) return null;
  const until = at + LOCK_MS;
  return until > now ? until : null;
}

/** "23h 5m" / "12m" (iOS DateComponentsFormatter, abbreviated). */
function remaining(until, now) {
  const minutes = Math.max(1, Math.ceil((until - now) / 60000));
  const h = Math.floor(minutes / 60);
  return h >= 1 ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

/** Whether a visit to the faucet is waiting for its payment on this address. */
export function faucetPending(address, now = Date.now()) {
  const p = read(PENDING_KEY);
  return Boolean(p && p.address === String(address).toLowerCase() && now - p.at < PENDING_MS);
}

const DROP = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5s-6.5 7.3-6.5 12a6.5 6.5 0 0 0 13 0c0-4.7-6.5-12-6.5-12z"/></svg>';
const HOURGLASS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/></svg>';
const CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.4l3 3 6-6.3" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M10 14L17 7M11 7h6v6"/></svg>';

/** The card for `address` (its kaspatest: form). */
export function faucetCardHtml(address, now = Date.now()) {
  const until = faucetUnlockAt(address, now);
  const checking = !until && faucetPending(address, now);
  const subtitle = checking
    ? "Waiting for the faucet's payment..."
    : until
      ? `Claimed. You can claim again in ${remaining(until, now)}.`
      : "Copies your chatting address and opens the TN10 faucet: paste it, pass the check and claim the most it offers.";
  return `
    <button class="faucet-card ${until ? "locked" : ""}" id="faucet" ${until ? "disabled" : ""}>
      <span class="faucet-icon">${checking ? HOURGLASS : until ? CHECK : DROP}</span>
      <span class="faucet-text">
        <span class="faucet-title">Claim Testnet Kaspa</span>
        <span class="muted tiny">${esc(subtitle)}</span>
      </span>
      ${until || checking ? "" : `<span class="muted faucet-open">${OPEN}</span>`}
    </button>`;
}

/** Copies the address, remembers the visit with the balance before it, and opens the faucet. */
export async function startFaucetClaim(address, balanceBefore) {
  try {
    await navigator.clipboard.writeText(address);
    toast("Your TN10 chatting address is copied. Paste it into the faucet's address field.");
  } catch { /* the faucet can still be filled in by hand */ }
  write(PENDING_KEY, { address: String(address).toLowerCase(), before: String(balanceBefore ?? 0n), at: Date.now() });
  try {
    await ext.tabs.create({ url: FAUCET_URL });
  } catch {
    window.open(FAUCET_URL, "_blank", "noopener,noreferrer");
  }
}

/**
 * After a visit: a chatting balance above the one before it means the claim landed - lock for 24
 * hours. Returns true when it just locked. A visit too old to count is forgotten, so the card is
 * free to try again.
 */
export function noteFaucetBalance(address, balanceSompi, now = Date.now()) {
  const p = read(PENDING_KEY);
  if (!p || p.address !== String(address).toLowerCase()) return false;
  if (now - p.at >= PENDING_MS) { write(PENDING_KEY, null); return false; }
  if (balanceSompi != null && BigInt(balanceSompi) > BigInt(p.before || "0")) {
    write(claimedKey(address), now);
    write(PENDING_KEY, null);
    return true;
  }
  return false;
}
