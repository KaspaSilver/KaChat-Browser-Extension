// The Address Book (iOS 00767a4 / cda0d99 AddressBookManager + AddressBookView): Kaspa addresses
// you saved with a name you'll recognize, and a note. Its own tab in the dock.
//
// One book per wallet (its chatting address, so per network too): switching accounts never shows
// who another wallet knows. It lives in this browser's extension storage only - no sync, no
// contacts of any kind. A deleted entry leaves a tombstone, as on iOS, so a future backup merge
// can't bring it back.
//
// An entry's picture is a photo you assign to it, or else exactly the avatar that address set on
// its own profile (iOS AddressBookAvatar) - looked up like any other profile here. Assigned photos
// are your data: kept as small JPEGs (at most 384 px, as iOS) beside the entries, deleted with
// their entry.
//
// The Send screens' recipient card shows the saved name of an address and opens the book to pick
// one (iOS SendKaspaComponents).

import { app, esc, render, $, toast, ICONS, navHeader, showSheet } from "./ui.js";
import { getLocal, setLocal } from "./browser.js";
import { openPanel } from "./kachat-ui.js";
import { isValidKaspaAddress, networkOfAddress, NETWORK } from "./net.js";
import { scanQr } from "./camera.js";
import * as dock from "./dock.js";
import * as wallet from "./wallet.js";
import { kachatProfiles, kachatSocial } from "./kachat-names.js";

const ENTRIES_PREFIX = "kachat_address_book_wallet_";
const DELETED_PREFIX = "kachat_address_book_deleted_wallet_";
const PHOTOS_PREFIX = "kachat_address_book_photos_wallet_";
const PHOTO_MAX_SIDE = 384;

const normalize = (address) => String(address ?? "").trim().toLowerCase();

let walletKey = null;
let entries = [];        // sorted by name
let deleted = {};        // address -> deletedAt (ms)
let photos = {};         // address -> data: URL (JPEG)
let loading = null;
const listeners = new Set();

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.address.localeCompare(b.address);

/** Loads the book of the wallet whose chatting address is `main` (call on every account change). */
export function useWallet(main) {
  const key = main ? normalize(main) : null;
  if (key === walletKey && loading) return loading;
  walletKey = key;
  entries = [];
  deleted = {};
  photos = {};
  if (!key) { changed(); return Promise.resolve(); }
  loading = (async () => {
    const [stored, tombstones, storedPhotos] = await Promise.all([
      getLocal(ENTRIES_PREFIX + key), getLocal(DELETED_PREFIX + key), getLocal(PHOTOS_PREFIX + key),
    ]).catch(() => [null, null, null]);
    if (walletKey !== key) return;
    entries = (Array.isArray(stored) ? stored : []).filter((e) => e && e.address && e.name).sort(byName);
    deleted = tombstones && typeof tombstones === "object" ? tombstones : {};
    photos = storedPhotos && typeof storedPhotos === "object" ? storedPhotos : {};
    changed();
  })();
  return loading;
}

export function onAddressBookChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() { for (const fn of listeners) { try { fn(); } catch { /* a listener's own problem */ } } }

export const addressBookEntries = () => entries;

/** The saved entry for `address`, or null. */
export function entryFor(address) {
  const a = normalize(address);
  return a ? entries.find((e) => e.address === a) ?? null : null;
}

function search(query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(q) || e.address.includes(q) || (e.note || "").toLowerCase().includes(q));
}

async function persist() {
  if (!walletKey) return;
  await Promise.all([
    setLocal(ENTRIES_PREFIX + walletKey, entries),
    setLocal(DELETED_PREFIX + walletKey, deleted),
    setLocal(PHOTOS_PREFIX + walletKey, photos),
  ]);
}

/** Why `address` can't be saved, or null. */
function invalidReason(address) {
  if (!isValidKaspaAddress(address)) return "Enter a valid Kaspa address.";
  if (networkOfAddress(address) !== NETWORK) return wallet.otherNetworkReason(address) || "Enter a valid Kaspa address.";
  return null;
}

/** Adds `address`, or updates its entry when it is already saved. `photo`: undefined (unchanged),
 *  a data: URL (set) or null (removed). */
async function save({ address, name, note = "", photo }) {
  if (!walletKey) throw new Error("Open a wallet first.");
  const a = normalize(address);
  const n = String(name ?? "").trim();
  if (!n) throw new Error("Enter a name.");
  const bad = invalidReason(a);
  if (bad) throw new Error(bad);
  const now = Date.now();
  const existing = entries.find((e) => e.address === a);
  if (existing) Object.assign(existing, { name: n, note: String(note ?? "").trim(), updatedAt: now });
  else entries.push({ id: crypto.randomUUID(), address: a, name: n, note: String(note ?? "").trim(), createdAt: now, updatedAt: now });
  delete deleted[a];
  if (photo === null) delete photos[a];
  else if (typeof photo === "string") photos[a] = photo;
  entries.sort(byName);
  await persist();
  changed();
  return entries.find((e) => e.address === a);
}

async function remove(address) {
  const a = normalize(address);
  const before = entries.length;
  entries = entries.filter((e) => e.address !== a);
  if (entries.length === before) return;
  deleted[a] = Date.now();
  delete photos[a];
  await persist();
  changed();
}

// --- Pictures ---------------------------------------------------------------------------------

const BOOK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5z"/><path d="M5 21.5A2.5 2.5 0 0 1 7.5 19H19v3H7.5"/></svg>';
const BOOK_FILL = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5v-17A2.5 2.5 0 0 1 7.5 2zM7.5 20H19v2H7.5a1 1 0 0 1 0-2z"/></svg>';
const PERSON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4 20.5c1.3-3.8 4.4-5.8 8-5.8s6.7 2 8 5.8z"/></svg>';
const SEND = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2.5L10 14M21.5 2.5L14.5 21.5l-4.5-7.5-7.5-4.5z"/></svg>';
const SHARE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v8h14v-8"/></svg>';
const PENCIL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 3.5l4 4L8 20H4v-4z"/></svg>';
const TRASH = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/></svg>';
const PLUS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const SCAN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>';

/** The profile avatar each address set for itself (null: none, or not looked up yet). */
const profileAvatars = new Map();
const lookingUp = new Set();

/** Looks up the avatar `address` set on its own profile, then repaints. */
async function lookUpAvatar(address) {
  if (profileAvatars.has(address) || lookingUp.has(address)) return;
  lookingUp.add(address);
  let url = null;
  try {
    const rt = await kachatProfiles();
    const profile = (await rt.registry.identity(address))?.profile;
    if (profile?.avatar) url = (await kachatSocial().profile(profile.avatar))?.avatar ?? null;
  } catch { url = null; }
  lookingUp.delete(address);
  profileAvatars.set(address, url);
  if (url) changed();
}

/** An entry's picture (iOS AddressBookAvatar): your photo, else the avatar its profile set. */
function avatarHtml(address, size = 40) {
  const a = normalize(address);
  const own = photos[a];
  if (!own) lookUpAvatar(a);
  const src = own || profileAvatars.get(a);
  return `<span class="ab-avatar" style="width:${size}px;height:${size}px">${src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" />` : PERSON}</span>`;
}

/** A picked image file as the JPEG an entry keeps: at most 384 px on its longer side, quality 0.8. */
async function preparedPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

const shortAddress = (a) => (a.length > 22 ? `${a.slice(0, 14)}...${a.slice(-6)}` : a);

// --- The tab: list with search ----------------------------------------------------------------

const view = { query: "" };
let detailAddress = null;

/** The Address Book tab's first screen (iOS AddressBookView). */
export async function showAddressBook() {
  await loading;
  detailAddress = null;
  paintList();
}

function rowsHtml(list) {
  return list.map((e) => `
    <button class="ab-row" data-ab="${esc(e.address)}">
      ${avatarHtml(e.address)}
      <span class="tx-meta">
        <span class="strong small ellipsis">${esc(e.name)}</span>
        <span class="mono tiny muted ellipsis">${esc(shortAddress(e.address))}</span>
      </span>
      <span class="km-chevron">${ICONS.chevron}</span>
    </button>`).join("");
}

function paintList() {
  const list = search(view.query);
  render(`
    ${dock.tabTopHtml("Address Book", { rightHtml: `<button class="icon plain accent" id="ab-add" aria-label="Add Address" title="Add Address">${PLUS}</button>` })}
    <section class="ab-screen">
      ${entries.length ? `
        <label class="ab-search">
          <span class="muted">${ICONS.search}</span>
          <input id="ab-search" value="${esc(view.query)}" placeholder="Search names and addresses" autocomplete="off" spellcheck="false" />
        </label>
        <div class="ab-list" id="ab-list">${list.length ? rowsHtml(list) : '<p class="muted small center-text">No matches.</p>'}</div>`
        : `
        <div class="ab-empty">
          <span class="accent">${BOOK}</span>
          <div class="strong">No saved addresses</div>
          <p class="muted small">Save the Kaspa addresses you use with a name you'll recognize. They stay in KaChat Wallet, for this wallet only.</p>
          <button class="with-icon" id="ab-add-empty">${PLUS}<span>Add Address</span></button>
        </div>`}
    </section>`, "book:home");
  dock.bindTabTop();
  dock.remember(() => showAddressBook());
  $("#ab-add").onclick = () => openEditor({ onSaved: (e) => showDetail(e.address) });
  const empty = $("#ab-add-empty");
  if (empty) empty.onclick = () => openEditor({ onSaved: (e) => showDetail(e.address) });
  const input = $("#ab-search");
  if (input) {
    input.oninput = () => {
      view.query = input.value;
      const found = search(view.query);
      $("#ab-list").innerHTML = found.length ? rowsHtml(found) : '<p class="muted small center-text">No matches.</p>';
      bindRows();
    };
  }
  bindRows();
}

function bindRows() {
  for (const row of app.querySelectorAll("[data-ab]")) row.onclick = () => showDetail(row.dataset.ab);
}

// Repaint whichever Address Book screen is showing when the book or a picture changes.
onAddressBookChange(() => {
  if (app.dataset.screen === "book:home") {
    const input = $("#ab-search");
    const focused = input && document.activeElement === input;
    paintList();
    if (focused) { const next = $("#ab-search"); next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  } else if (app.dataset.screen === "book:detail" && detailAddress) {
    showDetail(detailAddress);
  }
});

// --- Detail ------------------------------------------------------------------------------------

/** One entry (iOS AddressBookDetailView): Copy, Share, Send KAS, Edit, Delete. */
function showDetail(address) {
  const entry = entryFor(address);
  detailAddress = normalize(address);
  if (!entry) {
    render(`${navHeader({ title: "" })}<section class="ab-screen"><p class="muted center-text">Not in your Address Book</p></section>`, "book:detail");
    $("#back").onclick = showAddressBook;
    return;
  }
  const action = (id, icon, label, cls = "") => `<button class="ab-action ${cls}" id="${id}">${icon}<span>${esc(label)}</span></button>`;
  render(`
    ${navHeader({ title: entry.name })}
    <section class="ab-screen ab-detail">
      <div class="ab-head">
        ${avatarHtml(entry.address, 84)}
        <div class="ab-name">${esc(entry.name)}</div>
        ${entry.note ? `<p class="muted small center-text ab-note">${esc(entry.note)}</p>` : ""}
      </div>
      <div class="section-header">Address</div>
      <div class="glass ab-address mono small">${esc(entry.address)}</div>
      <div class="glass list ab-actions">
        ${action("ab-copy", ICONS.copy, "Copy Address")}
        ${action("ab-share", SHARE, "Share Address")}
        ${action("ab-send", SEND, "Send KAS")}
        ${action("ab-edit", PENCIL, "Edit")}
        ${action("ab-delete", TRASH, "Delete from Address Book", "danger-text")}
      </div>
    </section>`, "book:detail");
  dock.remember(() => showDetail(entry.address));
  $("#back").onclick = showAddressBook;
  $("#ab-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(entry.address); } catch { return; }
    const label = $("#ab-copy span");
    if (label) { label.textContent = "Copied"; setTimeout(() => { if (label.isConnected) label.textContent = "Copy Address"; }, 1500); }
  };
  $("#ab-share").onclick = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: entry.name, text: entry.address }); return; } catch { /* closed, or not allowed here */ }
    }
    try { await navigator.clipboard.writeText(entry.address); toast("Address copied - paste it wherever you want to share it."); } catch { /* nothing to do */ }
  };
  $("#ab-send").onclick = () => openSend?.(entry.address, () => showDetail(entry.address));
  $("#ab-edit").onclick = () => openEditor({ existing: entry, onSaved: (e) => showDetail(e.address), onRemoved: showAddressBook });
  $("#ab-delete").onclick = () => showSheet({
    title: `Delete ${entry.name} from your Address Book?`,
    rows: [{ label: "Delete", icon: TRASH, danger: true, onClick: async () => { await remove(entry.address); showAddressBook(); } }],
  });
}

/** How the detail opens a Send screen to an address (set by popup.js). */
let openSend = null;
export function setAddressBookSend(fn) { openSend = fn; }

// --- Add / edit -------------------------------------------------------------------------------

/**
 * Add to Address Book / Edit Address (iOS AddressBookEditor): the photo, the name, the address
 * (Paste, Scan QR) and a note. `address` prefills a new entry (Send's "save this address").
 */
export function openEditor({ existing = null, address = "", name = "", onSaved = () => {}, onRemoved = () => {} } = {}) {
  const form = {
    name: existing?.name ?? name,
    address: existing?.address ?? address,
    note: existing?.note ?? "",
    photo: undefined, // undefined unchanged, string set, null removed
    error: "",
  };
  const currentPhoto = () => (form.photo === undefined ? (existing ? photos[existing.address] : null) : form.photo);
  let handle = null;

  const paint = () => {
    if (!handle?.isOpen()) return;
    const host = handle.panel.querySelector("[data-ab-form]");
    const photo = currentPhoto();
    const shownAddress = normalize(form.address);
    const preview = photo
      ? `<span class="ab-avatar" style="width:84px;height:84px"><img src="${esc(photo)}" alt="" /></span>`
      : avatarHtml(shownAddress && !invalidReason(shownAddress) ? shownAddress : "", 84);
    host.innerHTML = `
      <div class="form-section ab-photo-section">
        ${preview}
        <div class="ab-photo-buttons">
          <label class="bar-text strong ab-file">${photo ? "Change Photo" : "Choose Photo"}<input type="file" id="ab-photo" accept="image/*" hidden /></label>
          ${photo ? '<button class="bar-text danger-text" id="ab-photo-remove">Remove Photo</button>' : ""}
        </div>
        <div class="form-footer center-text">Without a photo of your own, this shows the avatar they set on their profile.</div>
      </div>
      <div class="form-section">
        <div class="form-header">Name</div>
        <div class="form-card"><input class="form-row" id="ab-name" value="${esc(form.name)}" placeholder="Name" maxlength="60" autocomplete="off" /></div>
      </div>
      <div class="form-section">
        <div class="form-header">Address</div>
        <div class="form-card">
          <div class="form-row ab-address-row">
            <input id="ab-address" class="mono" value="${esc(form.address)}" placeholder="${NETWORK === "testnet" ? "kaspatest:" : "kaspa:"}..." autocomplete="off" autocapitalize="off" spellcheck="false" ${existing ? "readonly" : ""} />
            ${existing ? "" : `<button class="icon plain accent" id="ab-paste" aria-label="Paste" title="Paste">${ICONS.clipboard}</button>
            <button class="icon plain accent" id="ab-scan" aria-label="Scan QR" title="Scan QR">${SCAN}</button>`}
          </div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-card"><textarea class="form-row ab-note-input" id="ab-note" rows="3" placeholder="Note (optional)">${esc(form.note)}</textarea></div>
        <div class="form-footer">Saved in KaChat Wallet for this wallet only.</div>
        ${form.error ? `<div class="form-footer error-text">${esc(form.error)}</div>` : ""}
      </div>
      <div class="form-section"><div class="form-card">
        <button class="form-row km-form-button" id="ab-save">Save</button>
      </div></div>
      ${existing ? `<div class="form-section"><div class="form-card">
        <button class="form-row km-form-button danger-text" id="ab-remove">Remove from Address Book</button>
      </div></div>` : ""}`;
    const bind = (id, fn) => { const el = host.querySelector(`#${id}`); if (el) fn(el); };
    bind("ab-name", (el) => { el.oninput = () => { form.name = el.value; }; });
    bind("ab-note", (el) => { el.oninput = () => { form.note = el.value; }; });
    bind("ab-address", (el) => { el.oninput = () => { form.address = el.value; }; el.onchange = paint; });
    bind("ab-paste", (el) => { el.onclick = async () => { try { form.address = (await navigator.clipboard.readText()).trim(); } catch { toast("Clipboard unavailable - paste with ⌘V instead."); } paint(); }; });
    bind("ab-scan", (el) => {
      el.onclick = async () => {
        const code = await scanQr({ title: "Scan QR Code", hint: "Point camera at a Kaspa address QR code" });
        if (!code) return;
        // a payment URI's address, without its ?amount=...
        form.address = String(code).trim().split("?")[0];
        paint();
      };
    });
    bind("ab-photo", (el) => {
      el.onchange = async () => {
        const file = el.files?.[0];
        if (!file) return;
        try { form.photo = await preparedPhoto(file); form.error = ""; } catch { form.error = "Couldn't use that photo."; }
        paint();
      };
    });
    bind("ab-photo-remove", (el) => { el.onclick = () => { form.photo = null; paint(); }; });
    bind("ab-save", (el) => {
      el.onclick = async () => {
        try {
          const saved = await save({ address: form.address, name: form.name, note: form.note, photo: form.photo });
          handle.close();
          onSaved(saved);
        } catch (error) {
          form.error = error.message;
          paint();
        }
      };
    });
    bind("ab-remove", (el) => {
      el.onclick = async () => {
        await remove(existing.address);
        handle.close();
        onRemoved();
      };
    });
  };

  handle = openPanel({
    title: existing ? "Edit Address" : "Add to Address Book",
    leading: "Cancel", full: true, stack: true,
    body: '<div data-ab-form></div>',
  });
  const off = onAddressBookChange(paint);
  const observer = new MutationObserver(() => { if (!handle.isOpen()) { off(); observer.disconnect(); } });
  observer.observe(document.body, { childList: true });
  paint();
}

// --- The picker (Send's Address Book button) ---------------------------------------------------

/** The book as a sheet to pick from (iOS AddressBookPickerSheet): calls `onPick(entry)`. */
export function openAddressBookPicker(onPick) {
  let query = "";
  const handle = openPanel({
    title: "Address Book", leading: "Cancel", full: true, stack: true,
    body: `
      <label class="ab-search">
        <span class="muted">${ICONS.search}</span>
        <input id="ab-pick-search" placeholder="Search names and addresses" autocomplete="off" spellcheck="false" />
      </label>
      <div class="ab-list" data-ab-pick></div>`,
  });
  const paint = () => {
    const host = handle.panel.querySelector("[data-ab-pick]");
    const list = search(query);
    host.innerHTML = entries.length
      ? (list.length ? rowsHtml(list) : '<p class="muted small center-text">No matches.</p>')
      : '<div class="ab-empty"><div class="strong">No saved addresses</div><p class="muted small">Add addresses in the Address Book tab.</p></div>';
    for (const row of host.querySelectorAll("[data-ab]")) {
      row.onclick = () => {
        const entry = entryFor(row.dataset.ab);
        handle.close();
        if (entry) onPick(entry);
      };
    }
  };
  const input = handle.panel.querySelector("#ab-pick-search");
  input.oninput = () => { query = input.value; paint(); };
  input.focus();
  paint();
}

/** The recipient card's Address Book button (shown once the book has an entry). */
export function addressBookButtonHtml() {
  return entries.length ? `<button class="icon plain accent" id="address-book" aria-label="Address Book" title="Address Book">${BOOK}</button>` : "";
}

/** The saved name of `address` under the recipient card (iOS: book.closed.fill + the name). */
export function savedNameHtml(address) {
  const entry = entryFor(address);
  return entry ? `<div class="sk-status accent ab-saved">${BOOK_FILL}<span>${esc(entry.name)}</span></div>` : "";
}
