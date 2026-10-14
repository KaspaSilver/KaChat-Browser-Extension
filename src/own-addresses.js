// "Your own address" (iOS 56f004f WalletManager.ownAddressLabel): the address card under every To
// field marks one of this wallet's own addresses - "Chatting Address", "Address #3" or the name you
// gave it - so it is clear you are sending to yourself. Worked out once per account and address
// count (hidden addresses included), then looked up synchronously while the card draws.

import * as wallet from "./wallet.js";
import * as vault from "./vault.js";

let labels = new Map(); // address -> label
let loadedKey = "";

/** Loads (or refreshes) this account's own addresses; resolves true when the list changed. */
export async function loadOwnAddresses() {
  try {
    const view = await vault.readAccounts();
    const main = (await wallet.cachedAddresses(view.activeAccountId))?.main || null;
    const list = await wallet.spendingList();
    const key = `${view.activeAccountId}|${main}|${list.rows.length}|${list.rows.map((r) => r.label).join(",")}`;
    if (key === loadedKey) return false;
    const next = new Map();
    if (main) next.set(main.toLowerCase(), "Chatting Address");
    for (const r of list.rows) next.set(r.address.toLowerCase(), r.label || `Address #${r.index}`);
    labels = next;
    loadedKey = key;
    return true;
  } catch {
    return false;
  }
}

/** "Chatting Address", "Address #3" or its name when `address` is this wallet's own, else null. */
export function ownAddressLabel(address) {
  return labels.get(String(address || "").trim().toLowerCase()) ?? null;
}
