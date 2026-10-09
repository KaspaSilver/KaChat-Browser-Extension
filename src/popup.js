// KaChat Wallet popup (and the same page opened as a full tab with ?view=tab): boot and the home
// screen, which is the iOS Profile tab. Sign-in, create and import live in onboarding.js; Send
// and Manage in send.js / manage.js; Your Domains in domains.js; Settings in settings.js.

import { ext, isExtension, tellBackground } from "./browser.js";
import * as vault from "./vault.js";
import * as wallet from "./wallet.js";
import {
  app, isTab, esc, render, $, toast, copyText, settings, noteActivity, ICONS, showQr, showQrPending, showSheet,
} from "./ui.js";
import { showSend } from "./send.js";
import { showManageAddress, showManageAddresses } from "./manage.js";
import { cachedOwnedNames, ownedNames, otherNamesCount } from "./names.js";
import { showWelcome, showUnlock, enterApp, setHandlers, setLoggedOut } from "./onboarding.js";
import { showDomains } from "./domains.js";
import { showKachatMarket, kachatWordmark } from "./market.js";
import { watchRegistrations, scheduleLapse, showLiveNameDetail } from "./kachat-live.js";
import * as bell from "./bell.js";
import * as addressBook from "./address-book.js";
import { startKachatNamesNotifier } from "./kachat-notifier.js";
import { kachatLive, kachatNames, kachatLabelOf, forgetKachatSigner, kachatSocial, ownKachatProfile } from "./kachat-names.js";
import { showKachatProfileEditor } from "./kachat-profile.js";
import { KachatNamesRegistry } from "../shared/engine/kachat-names/registry.js";
import { faucetCardHtml, startFaucetClaim, noteFaucetBalance, faucetPending } from "./faucet.js";
import { showSettings, showLicenses } from "./settings.js";
import { showApproval } from "./approve.js";
import * as dock from "./dock.js";
import { NETWORK, NETWORK_MIRROR_KEY, IS_TESTNET, syncNetworkMirror } from "./net.js";
import { showColdStorage, coldWatchAddresses } from "./cold.js";
import { showPortfolio } from "./portfolio.js";
import { showCameraPermissionPage } from "./camera.js";

const params = new URLSearchParams(location.search);
const isApproval = params.get("view") === "approve";

// --- boot --------------------------------------------------------------------------------

async function boot() {
  if (!isExtension) {
    render('<section class="screen center"><p class="center-text">Open this page from the KaChat Wallet extension.</p></section>');
    return;
  }
  await syncNetworkMirror();
  // Start the 12 MB WASM download/compile now, while the first screen is up.
  wallet.kaspa().catch(() => {});
  wallet.useExplorer((await settings()).explorer);
  // A website's request (background.js opened this window for it).
  if (isApproval) return showApproval(params.get("id") || "");
  // The one-time camera permission page the scanner opens from the popup.
  if (params.get("view") === "camera") return showCameraPermissionPage(app);
  if (!(await vault.hasVault())) return showWelcome();
  if (!(await vault.isUnlocked())) return showUnlock();
  noteActivity();
  return enterApp();
}

// The Profile tab's screens keep the dock; sheets and full-screen flows (send, keys, QR) don't.
dock.showsDock("home", "manage-chat", "manage-list", "manage-spending", "domains", "domain-detail",
  "settings", "licenses", "kachat-name", "identity-picker", "identity-detail");
dock.registerTab("profile", () => showHome());
dock.registerTab("cold", () => showColdStorage());
dock.registerTab("portfolio", () => showPortfolio());
// the .kachat marketplace, its own tab left of Profile
dock.registerTab("kachat", () => showKachatMarket());
dock.registerTab("book", () => addressBook.showAddressBook());
// The Address Book's Send KAS: Send Kaspa from the chatting address, to the saved address.
addressBook.setAddressBookSend((address, onClose) => {
  const main = homeState?.addresses?.main;
  if (main) showSend({ source: { kind: "main" }, fromAddress: main, recipient: address, onClose });
});

setHandlers({
  home: () => showHome(),
  settings: (opts) => showSettings(opts),
});

// The wallet can lock under an open popup (auto-lock alarm, or the lock button in another
// window): the unlock key disappears from storage.session, and the popup follows.
ext?.storage?.onChanged?.addListener((changes, area) => {
  // The network was switched in another KaChat Wallet window: this one follows (net.js).
  if (area === "local" && changes[NETWORK_MIRROR_KEY] && changes[NETWORK_MIRROR_KEY].newValue !== NETWORK) {
    location.reload();
    return;
  }
  if (isApproval) return;
  if (area === "session" && changes["kachat.unlockKey"] && !changes["kachat.unlockKey"].newValue) {
    forgetKachatSigner();
    wallet.disconnect();
    dock.enableDock(false);
    showUnlock();
  }
});

// --- home: the iOS Profile tab ------------------------------------------------------------
//
// Section for section as ProfileView lays it out: the toolbar (connection dot, balance in the
// middle - lock and expand where iOS has the notification bell, which is chat-only), the pinned
// "Profile" title with the share button, then account name, profile hero, the two QR buttons,
// the Chatting and Spending rows, Your Domains, Settings, Log Out and About. Help is left out:
// its guides are the chat Welcome Guide and the KNS setup guide.
//
// No Create / Edit KNS Profile: profile creation is moving to .kachat names, which do not exist
// yet. Like iOS (5.2), only a .kas domain's NAME is read - no avatar, banner or bio: full
// profiles will come from .kachat. Your Domains counts .kas, .k and .kaspa names together.

let homeState = null;

function connectionDot(state) {
  const cls = state === "ok" ? "ok" : state === "bad" ? "bad" : "busy";
  const label = state === "ok" ? "Connected" : state === "bad" ? "Not connected" : "Connecting";
  return `<button class="dot-button" id="dot" aria-label="${label}" title="${label}"><span class="dot ${cls}"></span></button>`;
}

async function showHome() {
  dock.enableDock(true);
  dock.resetTab("profile");
  const accounts = await vault.readAccounts().catch(() => null);
  if (!accounts) return showUnlock();
  const account = accounts.accounts.find((a) => a.id === accounts.activeAccountId) || accounts.accounts[0];
  const currency = (await settings()).currency || "usd";
  const cached = await wallet.cachedAddresses(account.id);
  const spending = await wallet.spendingState(account.id);
  // The bell keeps a feed per account (its chatting address) and network.
  bell.useAccount(cached?.main || null);
  // One Address Book per wallet (iOS 00767a4).
  addressBook.useWallet(cached?.main || null);
  homeState = {
    account,
    currency,
    addresses: cached,
    spending,
    balances: null,
    kns: cached?.main ? wallet.cachedKns(cached.main) : null,
    otherNames: cached?.main ? cachedOwnedNames(cached.main) : null,
    connection: "busy",
    editingName: false,
    error: "",
  };
  paintHome();
  refreshHome();
}

// --- Expired .kachat names (iOS 6ac48a7): a dismissible banner while any is in its grace period ---

const GRACE_DISMISSED_KEY = "kachat_grace_banner_dismissed";
const graceDismissed = () => { try { return localStorage.getItem(GRACE_DISMISSED_KEY) || ""; } catch { return ""; } };

function graceBannerHtml(s) {
  const grace = s.graceNames || [];
  if (!kachatLive || !grace.length || graceDismissed() === s.graceKey) return "";
  const one = grace.length === 1;
  const ends = one ? new Date(grace[0].endsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  return `
    <div class="grace-banner" id="grace-banner" role="button" tabindex="0">
      <span class="grace-icon">${ICONS.warning}</span>
      <span class="grace-text">
        <span class="strong small">${one ? "One of your .kachat domains expired" : `${grace.length} of your .kachat domains expired`}</span>
        <span class="muted tiny">${esc(one ? `Renew ${grace[0].info.name}.kachat before its grace period ends on ${ends} to keep it.` : "Renew them before their grace periods end to keep them.")}</span>
      </span>
      <button class="icon plain" id="grace-dismiss" aria-label="Dismiss">${ICONS.xCircle}</button>
    </div>`;
}

function bindGraceBanner(s) {
  const banner = $("#grace-banner");
  if (!banner) return;
  // one name opens it; several open Your Domains (its .kachat tab lists them)
  banner.onclick = () => {
    const grace = s.graceNames || [];
    if (grace.length === 1) showLiveNameDetail({ info: grace[0].info, onBack: showHome });
    else if (s.addresses?.main) showDomains({ address: s.addresses.main, onBack: showHome });
  };
  $("#grace-dismiss").onclick = (event) => {
    event.stopPropagation();
    try { localStorage.setItem(GRACE_DISMISSED_KEY, s.graceKey || ""); } catch { /* shows again next time */ }
    banner.remove();
  };
}

function spendingTotal(balances) {
  if (!balances) return null;
  return Object.values(balances.spending || {}).reduce((sum, value) => sum + BigInt(value || 0n), 0n);
}

function profileLinkFor(address) {
  return `https://kachat.app/u/${String(address || "").replace(/^kaspa:/, "")}`;
}

function paintHome() {
  const s = homeState;
  if (!s) return;
  const main = s.addresses?.main || null;
  const primary = s.addresses?.spending?.[s.spending.activeIndex] || null;
  const mainSompi = s.balances?.main;
  const primarySompi = s.balances ? (s.balances.spending[s.spending.activeIndex] ?? 0n) : null;
  const totalSpending = spendingTotal(s.balances);
  const kns = s.kns || {};
  // What other people see you as (iOS profileHeroSection): your .kachat name once you have one
  // (live on testnet: your primary name while active, else your oldest active name), else your
  // short address - never the account name (your own label), and since 5.2 not your .kas name
  // either (that is managed in Your Domains).
  const kachatName = kachatLive && s.kachatLabel ? `${s.kachatLabel}.kachat` : null;
  // The address profile (avatar, banner and bio looked up from its social links) - every network
  // (iOS d36fc42); the .kachat label only where names are live.
  const social = s.kachatSocial || {};
  const displayName = kachatName || shortIdentity(main);
  // Every name the account owns: .kachat (iOS 10e4a1a - 0 where the registry isn't launched), KNS,
  // .k and .kaspa.
  const domainCount = kns.known ? (s.kachatCount || 0) + kns.domainCount + otherNamesCount(s.otherNames) : null;
  const created = s.account.createdAt ? new Date(s.account.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
  const version = ext?.runtime?.getManifest?.().version || "";

  render(`
    <div class="profile">
      <header class="toolbar">
        ${connectionDot(s.connection)}
        <button class="toolbar-balance" id="balance" aria-label="Copy balance">
          <img src="icons/kaspa-logo.png" alt="" />
          <span>${mainSompi != null ? esc(wallet.formatKas(mainSompi, 8)) : "--"} KAS</span>
        </button>
        <div class="toolbar-right">
          ${bell.bellButtonHtml()}
          ${isTab ? "" : `<button class="icon" id="expand" aria-label="Open in a tab" title="Open in a tab">${ICONS.expand}</button>`}
          <button class="icon" id="lock" aria-label="Lock" title="Lock">${ICONS.lock}</button>
        </div>
      </header>
      <div class="profile-title">
        <h1>Profile</h1>
        <button class="share-circle" id="share" aria-label="Share your profile" title="Copy your profile link" ${main ? "" : "disabled"}>${ICONS.share}</button>
      </div>
      <section class="profile-body">
        <div class="account-row">
          ${s.editingName
            ? `<input id="account-name" value="${esc(s.account.name)}" maxlength="40" aria-label="Account name" autofocus />
               <button class="icon plain" id="save-name" aria-label="Save name">${ICONS.checkCircle}</button>`
            : `<span class="account-name">${esc(s.account.name)}</span>
               <button class="icon plain" id="edit-name" aria-label="Rename account">${ICONS.pencilCircle}</button>`}
        </div>

        ${graceBannerHtml(s)}
        <div class="glass hero">
          ${social.banner
            ? `<div class="fit-banner" style="--placeholder: 140px"><img src="${esc(social.banner)}" alt="" referrerpolicy="no-referrer" /></div>`
            : '<div class="banner gradient"></div>'}
          <div class="hero-row">
            ${social.avatar
              ? `<div class="avatar"><img src="${esc(social.avatar)}" alt="" referrerpolicy="no-referrer" /></div>`
              : `<div class="avatar avatar-glyph">${ICONS.person}</div>`}
            <button class="hero-edit" id="edit-kachat-profile">Edit KaChat Profile</button>
          </div>
          <div class="hero-text">
            <div class="hero-name">${esc(displayName)}</div>
            ${social.bio ? `<div class="hero-bio muted small">${esc(social.bio)}</div>` : ""}
            ${social.linktree ? `<a class="hero-link" href="${esc(social.linktree)}" target="_blank" rel="noopener noreferrer">${ICONS.link || ""}<span>${esc(social.linktree.replace("https://", ""))}</span></a>` : ""}
          </div>
        </div>

        <div class="qr-buttons">
          <button class="qr-button" id="receive" ${primary ? "" : "disabled"}>
            <span class="qr-circle">${ICONS.qrBig}</span><span>Receive Kaspa</span>
          </button>
          <button class="qr-button" id="chatting-qr" ${main ? "" : "disabled"}>
            <span class="qr-circle">${ICONS.qrBig}</span><span>Chatting Address</span>
          </button>
        </div>

        ${IS_TESTNET && main ? faucetCardHtml(main) : ""}
        ${addressActionRowHtml("chatting", "Chatting", main, mainSompi != null ? `${wallet.formatKas(mainSompi, 8)} KAS` : null, null)}
        ${addressActionRowHtml("spending", "Spending", primary, primarySompi != null ? `${wallet.formatKas(primarySompi, 8)} KAS` : null, totalSpending != null ? `Total: ${wallet.formatKas(totalSpending, 8)} KAS` : null)}

        <button class="glass nav-row" id="domains">
          <span class="nav-row-label">${ICONS.at}<span>Your Domains</span></span>
          <span class="nav-row-value">${domainCount != null ? esc(String(domainCount)) : ""}</span>${ICONS.chevron}
        </button>
        <button class="glass nav-row" id="kachat-names">
          <span class="nav-row-label">${kachatWordmark(22)}<span>Marketplace</span></span>
          ${kachatLive ? '<span class="kl-testnet">Testnet</span>' : '<span class="coming-pill">Coming soon</span>'}${ICONS.chevron}
        </button>
        <button class="glass nav-row" id="settings">
          <span class="nav-row-label">${ICONS.gear}<span>Settings</span></span>${ICONS.chevron}
        </button>
        <button class="glass nav-row danger-row" id="logout">
          <span>Log Out</span>${ICONS.logout}
        </button>

        <div class="section-header">About</div>
        <div class="glass list">
          <div class="list-row"><span>Created</span><span class="muted">${esc(created)}</span></div>
          <div class="list-row"><span>Version</span><span class="muted">${esc(version)}</span></div>
          <a class="list-row" href="https://linktr.ee/Kachat_" target="_blank" rel="noopener noreferrer"><span>Website</span><span class="muted">linktr.ee/Kachat_</span></a>
          <a class="list-row" href="mailto:kaspasilver@gmail.com"><span>Support Email</span><span class="muted">kaspasilver@gmail.com</span></a>
          <button class="list-row" id="donate"><span>Donate</span><span class="muted">kachat.kachat</span></button>
          <button class="list-row" id="licenses"><span>Open Source Licenses</span>${ICONS.chevron}</button>
        </div>
      </section>
    </div>`, "home");

  $("#dot").onclick = () => toast(s.connection === "ok" ? `Connected to ${wallet.connectedNodeUrl().replace(/^wss:\/\//, "")}` : s.connection === "bad" ? "Can't reach a Kaspa node - retrying" : "Connecting to the Kaspa network…");
  $("#balance").onclick = () => { if (mainSompi != null) copyText(wallet.formatKas(mainSompi, 8), "Balance"); };
  $("#lock").onclick = lockWallet;
  $("#bell").onclick = openBell;
  bindGraceBanner(s);
  const expand = $("#expand");
  if (expand) expand.onclick = async () => { await ext.tabs.create({ url: ext.runtime.getURL("popup.html?view=tab") }); window.close(); };
  if (main) $("#share").onclick = () => copyText(profileLinkFor(main), "Profile link");

  if (s.editingName) {
    const input = $("#account-name");
    const commit = async () => {
      const name = input.value.trim();
      s.editingName = false;
      if (name && name !== s.account.name) {
        const view = await vault.renameAccount(s.account.id, name);
        s.account = view.accounts.find((a) => a.id === s.account.id) || s.account;
        toast("Account renamed.");
      }
      paintHome();
    };
    $("#save-name").onclick = commit;
    input.onkeydown = (event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") { s.editingName = false; paintHome(); } };
    input.select();
  } else {
    $("#edit-name").onclick = () => { s.editingName = true; paintHome(); };
  }

  // Receive hands out a never-used address (iOS ReceiveKaspaQRView over freshReceiveAddress):
  // "Preparing a fresh address" while it is worked out, then the white QR page with the
  // address's balance in the bar.
  if (primary) $("#receive").onclick = async () => {
    showQrPending({ onBack: showHome });
    let address;
    try { address = await wallet.freshReceiveAddress(); } catch { address = null; }
    if (app.dataset.screen !== "qr") return;
    if (!address) return showQrPending({ failed: true, onBack: showHome });
    let balanceSompi = null;
    try { balanceSompi = (await wallet.balancesFor([address]))[address] ?? null; } catch { /* unknown - nothing shown */ }
    if (app.dataset.screen !== "qr") return;
    showQr({
      address,
      balanceSompi,
      note: "A fresh address, never used before. Kaspa sent here lands in this account and shows in your spending total. This address should be used for everything not related to chatting or domains.",
      onBack: showHome,
    });
  };
  // Shown from the recovery phrase, not only the cache (audit EXT-006).
  if (main) $("#chatting-qr").onclick = async () => showQr({
    address: (await wallet.identityFor(s.account.id).catch(() => null))?.address || main,
    balanceSompi: mainSompi,
    note: "This address should be for chatting and domains only. 1 Kaspa is enough for about 500 interactions in the app. Domains cost from 35 to 4,000 Kaspa, depending on the name.",
    onBack: paintHome,
  });
  for (const [kind, address] of [["chatting", main], ["spending", primary]]) {
    const copy = $(`#copy-${kind}`);
    if (copy && address) copy.onclick = () => copyText(address);
  }
  const mainSource = { kind: "main" };
  const spendingSource = { kind: "spending", index: s.spending.activeIndex };
  // The Profile Send buttons: WithdrawKaspaView ("Send Kaspa") for the chatting address,
  // SpendingAddressWithdrawView ("Send Kaspa from Address #n") for the primary spending one.
  $("#send-chatting").onclick = () => {
    if (main) showSend({ source: mainSource, fromAddress: main, navTitle: "Send Kaspa", feeFooter: "If the network is busy, Fast or Priority pays a higher fee to help your withdrawal confirm sooner. Tap the fee amount to set a custom fee.", onClose: showHome });
  };
  $("#send-spending").onclick = () => {
    if (primary) showSend({ source: spendingSource, fromAddress: primary, navTitle: `Send Kaspa from Address #${s.spending.activeIndex}`, feeFooter: "If the network is busy, Fast or Priority pays a higher fee to help this confirm sooner. Tap the fee amount to set a custom fee.", onClose: showHome });
  };
  $("#manage-chatting").onclick = () => {
    if (!main) return;
    showManageAddress({
      address: main, onBack: showHome,
      onChangeIdentity: s.account.imported ? () => { homeState = null; showHome(); } : null,
    });
  };
  $("#manage-spending").onclick = () => showManageAddresses({ onBack: showHome });
  $("#domains").onclick = () => { if (main) showDomains({ address: main, onBack: showHome }); };
  $("#kachat-names").onclick = () => dock.selectTab("kachat");
  $("#edit-kachat-profile").onclick = () => showKachatProfileEditor({ onSaved: () => refreshHome() });
  // Claim Testnet Kaspa (testnet only): the faucet opens in a tab; a wallet open in its own tab
  // watches the chatting balance for a minute, the popup checks it next time it opens.
  const faucet = $("#faucet");
  if (faucet) faucet.onclick = async () => {
    await startFaucetClaim(main, s.balances?.main ?? 0n);
    paintHomeIfShowing(s);
    for (let i = 0; i < 12 && isTab; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (homeState !== s) return;
      await refreshHome();
      if (!faucetPending(main)) return;
    }
  };
  $("#settings").onclick = () => showSettings({ onBack: showHome });
  $("#logout").onclick = () => showSheet({
    title: "Log Out",
    rows: [{
      label: "Log Out",
      subtitle: "Signs out of this account. Wallet data stays in this browser.",
      icon: ICONS.logout,
      danger: true,
      onClick: logOut,
    }],
  });
  // iOS Donate (e7cc0d5): the Send screen with kachat.kachat filled in; it resolves like any typed
  // name (.kachat first), and where it isn't registered Other domains offers kachat elsewhere.
  $("#donate").onclick = () => { if (main) showSend({ source: mainSource, fromAddress: main, recipient: "kachat.kachat", title: "Donate to KaChat", onClose: showHome }); };
  $("#licenses").onclick = () => showLicenses({ onBack: showHome });
}

// iOS Log Out: back to the accounts screen, where you pick an account (or add one). The vault
// stays unlocked; the lock button is what asks for the password again.
async function logOut() {
  dock.enableDock(false);
  await setLoggedOut(true);
  homeState = null;
  forgetKachatSigner();
  await wallet.disconnect();
  showWelcome();
}

async function lockWallet() {
  dock.enableDock(false);
  forgetKachatSigner();
  await vault.lock();
  tellBackground({ type: "lock" });
  await wallet.disconnect();
  showUnlock();
}

/** iOS Contact.generateDefaultAlias: "kaspa:" + the first 4 and last 4 of the address body. */
function shortIdentity(address) {
  const text = String(address || "");
  const colon = text.indexOf(":");
  if (colon < 0) return text || "…";
  const prefix = text.slice(0, colon);
  const body = text.slice(colon + 1);
  return body.length > 12 ? `${prefix}:${body.slice(0, 4)}....${body.slice(-4)}` : text;
}

// One address row: title + balance on the left (tapping it copies the address), then the
// Send and Manage circles - iOS addressActionRow.
function addressActionRowHtml(kind, title, address, balanceText, totalText) {
  return `
    <div class="glass address-action">
      <button class="address-copy" id="copy-${kind}" aria-label="Copy ${esc(title)} address" ${address ? "" : "disabled"}>
        <span class="address-title">${esc(title)}</span>
        ${address ? "" : '<span class="muted tiny">Address unlocking...</span>'}
        ${balanceText != null ? `<span class="address-balance">${esc(balanceText)}</span>` : '<span class="spinner small-spin"></span>'}
        ${totalText ? `<span class="muted tiny">${esc(totalText)}</span>` : ""}
      </button>
      <button class="circle-action" id="send-${kind}" aria-label="Send">${ICONS.sendCircle}</button>
      <button class="circle-action" id="manage-${kind}" aria-label="Manage">${ICONS.gear}</button>
    </div>`;
}

// --- The bell (iOS GlobalNotificationListView): received Kaspa and .kachat news -------------

/** Repaints just the bell's dot when the feed changes. */
bell.onBellChange(() => {
  // the Profile tab's red dot follows the bell from any tab (iOS 28d9d68)
  dock.setBadge("profile", bell.unreadCount() > 0);
  const button = app.querySelector("#bell");
  if (!button) return;
  button.outerHTML = bell.bellButtonHtml();
  app.querySelector("#bell").onclick = openBell;
});

function openBell() {
  bell.showBell({
    // a receipt opens the wallet, as iOS opens Portfolio
    openWallet: () => dock.selectTab("portfolio"),
    // a .kachat row opens the name; one that's free again opens the marketplace to claim it
    openName: async (name) => {
      try {
        const rt = await kachatNames();
        const found = rt ? await rt.registry.lookup(name) : null;
        if (found?.kind === "registered") return showLiveNameDetail({ info: found.info, onBack: showHome });
      } catch { /* the marketplace then */ }
      dock.selectTab("kachat");
    },
  });
}

/** Every address of the account, labelled the way the bell describes it (iOS describe(address)). */
async function bellReceipts(s) {
  const list = [{ address: s.addresses.main, label: "Chatting address" }];
  for (const address of Object.values(s.addresses.spending || {})) list.push({ address, label: "Spending address" });
  try {
    for (const c of await coldWatchAddresses()) list.push({ address: c.address, label: `Cold storage (${c.account})` });
  } catch { /* no KasSigner accounts */ }
  bell.checkReceipts(list);
}

let refreshing = false;
async function refreshHome() {
  if (refreshing || !homeState) return;
  refreshing = true;
  const s = homeState;
  try {
    // Addresses first: derived from the phrase (a moment of CPU on first unlock), then cached.
    if (!s.addresses || s.addresses.accountId !== s.account.id || !s.addresses.spending?.[s.spending.maxIndex]) {
      s.addresses = await wallet.deriveAddresses();
      bell.useAccount(s.addresses.main);
      addressBook.useWallet(s.addresses.main);
      s.kns = wallet.cachedKns(s.addresses.main);
      s.otherNames = cachedOwnedNames(s.addresses.main);
      paintHomeIfShowing(s);
    }
    wallet.kns(s.addresses.main).then((info) => { s.kns = info; paintHomeIfShowing(s); }).catch(() => {});
    // .k / .kaspa names change rarely; the 30 s balance refresh asks for them every 5 minutes.
    if (!s.otherNamesAt || Date.now() - s.otherNamesAt > 5 * 60_000) {
      s.otherNamesAt = Date.now();
      ownedNames(s.addresses.main).then((owned) => { s.otherNames = owned; paintHomeIfShowing(s); }).catch(() => {});
    }
    try {
      await wallet.connection();
      s.connection = "ok";
      dock.setStatus({ connection: "ok", nodeUrl: wallet.connectedNodeUrl() });
      paintHomeIfShowing(s);
      // Testnet: the .kachat label for the hero, and registrations in flight resume (iOS resumes
      // them when the app becomes active).
      if (kachatLive) {
        const main = s.addresses.main;
        kachatNames()
          .then(async (rt) => {
            // The .kachat names for the Your Domains count: the set its .kachat tab lists - active
            // names and expired ones in grace, never lapsed ones (iOS aa36d2a heldNames).
            const key = KachatNamesRegistry.keyOf(main.toLowerCase());
            const countHeld = async () => {
              const held = await rt.registry.heldNames(key).catch(() => null);
              if (!held || s.addresses?.main !== main) return;
              // the ones expired and in grace: the Profile banner (iOS 6ac48a7)
              const graceMs = rt.registry.graceMs;
              const grace = held.filter((n) => n.status(graceMs) === "grace").map((n) => ({ info: n, endsAt: Number(n.expiresAt + graceMs) }));
              const graceKey = grace.map((g) => `${g.info.name}:${g.info.expiresAt}`).join(",");
              if (s.graceKey !== graceKey) { s.graceKey = graceKey; s.graceNames = grace; paintHomeIfShowing(s); }
              if (s.kachatCount !== held.length) { s.kachatCount = held.length; paintHomeIfShowing(s); }
              // a name that lapses while the wallet is open comes off the count right then
              scheduleLapse("count", held, countHeld);
            };
            if (rt && key) await countHeld();
            // an open registration brings its progress sheet back up (iOS 61fb0fc)
            watchRegistrations();
            // the bell's .kachat news: offers, sales, renewal and expiry (iOS 86471dd)
            startKachatNamesNotifier();
            return kachatLabelOf(main);
          })
          .then((label) => { if (s.addresses?.main === main && s.kachatLabel !== label) { s.kachatLabel = label; paintHomeIfShowing(s); } })
          .catch(() => {});
      }
      loadKachatSocial(s, s.addresses.main);
      s.balances = await wallet.balances(s.addresses, s.spending.hidden);
      // The bell: Kaspa that arrived in any of this account's addresses since the last look.
      bellReceipts(s);
      // A faucet visit's payment landed: Claim Testnet Kaspa locks for 24 hours.
      if (IS_TESTNET) noteFaucetBalance(s.addresses.main, s.balances.main);
      // The other tabs' toolbars show the chatting wallet's balance, as iOS does.
      dock.setStatus({ balanceText: wallet.formatKas(s.balances.main, 8) });
    } catch (error) {
      s.connection = "bad";
      dock.setStatus({ connection: "bad" });
      console.warn("[KaChat Wallet] network:", error);
    }
  } catch (error) {
    s.error = error.message;
    toast(error.message);
  } finally {
    refreshing = false;
    paintHomeIfShowing(s);
  }
}

/** Testnet: the hero's .kachat avatar, banner, bio and Linktree from the account's profile record,
 *  each piece looked up from its social link (cached 24 h; repainted when a lookup lands). */
async function loadKachatSocial(s, main) {
  const profile = await ownKachatProfile(main);
  if (s.addresses?.main !== main) return;
  const resolver = kachatSocial();
  const read = async () => {
    const piece = async (kind) => (profile?.[kind] ? (await resolver.profile(profile[kind]))?.[kind] ?? null : null);
    const next = { avatar: await piece("avatar"), banner: await piece("banner"), bio: await piece("bio"), linktree: profile?.linktree ?? null };
    if (JSON.stringify(next) !== JSON.stringify(s.kachatSocial || {})) {
      s.kachatSocial = next;
      paintHomeIfShowing(s);
    }
  };
  if (!s.kachatSocialUnsubscribe) {
    s.kachatSocialUnsubscribe = resolver.onChange((link) => {
      if (homeState === s && profile && [profile.avatar, profile.banner, profile.bio].includes(link)) read();
    });
  }
  await read();
}

function paintHomeIfShowing(state) {
  // Only repaint when the home screen for this state is what's on screen, and never under
  // someone typing a new account name.
  if (homeState === state && app.dataset.screen === "home" && !state.editingName) {
    const scroller = app.querySelector(".profile-body");
    const scrollTop = scroller?.scrollTop || 0;
    paintHome();
    const next = app.querySelector(".profile-body");
    if (next) next.scrollTop = scrollTop;
  }
}

// Balances stay current while the popup is open.
setInterval(() => { if (homeState && app.dataset.screen === "home") refreshHome(); }, 30_000);

// --- QR ----------------------------------------------------------------------------------

boot();
