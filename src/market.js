// .kachat - the marketplace for KaChat's own names, a 1:1 port of iOS KachatMarketView,
// KachatListingDetailView, KachatBuySheet and KachatOfferSheet (Kaspa Hub > .kachat on iOS; here
// the .kachat row under Your Domains).
//
// On mainnet it is UI only, as on iOS: search answers "Registration isn't open yet", listings,
// offers and activity are placeholder skeletons, and every final action is disabled. No invented
// names or prices anywhere - the skeletons are redacted shapes (iOS .redacted(reason:
// .placeholder)), so nothing here can be mistaken for a real listing.
//
// On TESTNET (testnet-10, with the bundled registry manifest verified) it is live
// (kachat-live.js, iOS KachatNamesLiveViews.swift): search shows real availability and the price,
// Claim registers, the tabs read the registry, and registrations in flight show their progress.

import { app, esc, render, $, ICONS, navHeader } from "./ui.js";
import { SYMBOLS, kachatWordmark, openPanel } from "./kachat-ui.js";
import { kachatLive } from "./kachat-names.js";
import * as live from "./kachat-live.js";

export { kachatWordmark };

const redact = (text) => `<span class="redacted">${esc(text)}</span>`;
const pill = () => '<span class="coming-pill">Coming soon</span>';
const header = (title, detail) => `
  <div class="km-header"><div class="km-title">${esc(title)}</div>${detail ? `<div class="muted tiny">${esc(detail)}</div>` : ""}</div>`;

let page = "market"; // kept while you go into a listing and back, like iOS @State

export function showKachatMarket({ onBack }) {
  const state = { search: "" };
  const back = () => showKachatMarket({ onBack });
  const isLive = () => kachatLive && live.hub.isLive;
  const nav = { openName: (info) => { live.hub.onChange = null; live.showLiveNameDetail({ info, onBack: back }); } };

  const searchResult = () => {
    const typed = state.search.trim().toLowerCase();
    if (!typed) return "";
    if (isLive()) return live.searchResultHtml(typed);
    return `
      <div class="km-card km-search-result">
        <div class="tx-meta"><span class="strong ellipsis">${esc(typed)}.kachat</span><span class="muted tiny">Registration isn't open yet.</span></div>
        <button class="km-prominent small-button" disabled>Claim</button>
      </div>`;
  };

  const featured = () => `
    <button class="km-featured" data-listing>
      <div class="km-featured-card">${redact("name.kachat")}</div>
      <div class="strong small">${redact("000 KAS")}</div>
      <div class="accent tiny strong">${redact("Buy")}</div>
    </button>`;

  const listingRow = () => `
    <button class="km-row" data-listing>
      <span class="km-dot"></span>
      <span class="tx-meta"><span class="strong small">${redact("somename.kachat")}</span><span class="tiny">${redact("listed 1h ago")}</span></span>
      <span class="strong small">${redact("000 KAS")}</span>
      <span class="km-chevron">${ICONS.chevron}</span>
    </button>`;

  const marketPage = () => `
    ${header("Featured", "Names their owners have put up for sale.")}
    <div class="km-hscroll">${featured().repeat(4)}</div>
    ${header("Recently listed")}
    <div class="km-card km-list">${Array.from({ length: 5 }, listingRow).join("")}</div>
    <button class="km-bordered with-icon" disabled>${SYMBOLS.tag}<span>List a Name for Sale</span></button>
    <p class="muted small center-text">Listings appear here once .kachat names launch.</p>`;

  const myNamesPage = () => `
    <div class="km-empty">
      <span class="accent">${ICONS.atCircle}</span>
      <div class="km-title">No .kachat names yet</div>
      <p class="muted small">Names you claim or buy show here. From here you'll set one as your name in chats, list it for sale, or send it to someone.</p>
      <button class="km-prominent" disabled>Claim a Name</button>
    </div>
    ${header("Offers", "Offers you've made, and offers on names you own. Accept one, or withdraw your own, from here.")}
    <div class="km-card km-empty-card muted small">No offers yet.</div>`;

  const activityPage = () => `
    ${header("Recent activity", "Claims, listings and sales across the marketplace.")}
    <div class="km-card km-list">
      ${["tag", "cart", "at", "arrows"].map((icon) => `
        <div class="km-row">
          <span class="accent km-icon">${SYMBOLS[icon]}</span>
          <span class="tx-meta"><span class="strong small">${redact("somename.kachat sold")}</span><span class="tiny">${redact("2h ago")}</span></span>
          <span class="small">${redact("000 KAS")}</span>
        </div>`).join("")}
    </div>
    <p class="muted small center-text">Activity appears here once .kachat names launch.</p>`;

  const paint = () => {
    const scroll = app.querySelector(".km")?.scrollTop || 0;
    render(`
      <header class="navbar">
        <button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button>
        <div class="nav-title">.kachat</div>
        <button class="icon plain nav-right accent" id="how" aria-label="How it works">${SYMBOLS.question}</button>
      </header>
      <section class="km">
        <div class="km-hero">
          ${kachatWordmark(64)}
          <h2>Your name on KaChat</h2>
          <p class="muted small">Claim a .kachat name, or buy and sell them peer to peer. The name and the payment settle together on Kaspa - nobody holds either in between.</p>
          <div id="km-status">${heroStatus()}</div>
        </div>
        <div class="km-search">
          <label class="km-card km-search-field">
            <span class="muted">${ICONS.search}</span>
            <input id="search" value="${esc(state.search)}" placeholder="Find a name" autocomplete="off" autocapitalize="off" spellcheck="false" />
            <span class="muted strong">.kachat</span>
          </label>
          <div id="search-result">${searchResult()}</div>
        </div>
        <div id="km-regs" class="kl-regs">${isLive() ? live.registrationCardsHtml() : ""}</div>
        <div class="underline-tabs" role="tablist">
          ${[["market", "Marketplace"], ["myNames", "My Names"], ["activity", "Activity"]].map(([id, title]) =>
            `<button role="tab" data-page="${id}" aria-selected="${id === page}">${title}</button>`).join("")}
        </div>
        <div class="km-page" id="km-page">${pageHtml()}</div>
      </section>`, "kachat-market");
    const scroller = app.querySelector(".km");
    if (scroller) scroller.scrollTop = scroll;
    $("#back").onclick = onBack;
    $("#how").onclick = () => showHowItWorks(isLive());
    const search = $("#search");
    search.oninput = () => {
      state.search = search.value;
      if (isLive()) live.hub.lookup(state.search.trim().toLowerCase());
      paintSearch();
    };
    for (const tab of app.querySelectorAll("[data-page]")) tab.onclick = () => { page = tab.dataset.page; paint(); };
    bindParts();
  };

  // Mainnet (or before the testnet registry is ready): the mockups.
  const mockPage = () => (page === "market" ? marketPage() : page === "myNames" ? myNamesPage() : activityPage());
  const pageHtml = () => (isLive() ? live.livePageHtml(page) : mockPage());
  const heroStatus = () => {
    if (isLive()) return live.testnetBadge();
    // The bundled manifest is for the previous registry: a calm "Setting up", no error (iOS d2e0673).
    if (kachatLive && live.hub.upgrading) {
      return `<div class="kl-badges">${live.testnetBadge()}<span class="coming-pill kl-setting-up">${SYMBOLS.hammer}<span>Setting up</span></span></div>
        <p class="muted tiny center-text">The .kachat registry on Testnet is being upgraded. Names open here again once the new registry is live.</p>`;
    }
    const error = kachatLive && live.hub.ready === false && live.hub.setupError
      ? `<p class="muted tiny center-text">${esc(live.hub.setupError)}</p>` : "";
    return pill() + error;
  };
  const bindParts = () => {
    for (const listing of app.querySelectorAll("[data-listing]")) listing.onclick = () => showListing({ onBack: back });
    if (!isLive()) return;
    live.bindSearchResult($("#search-result"), nav);
    live.bindRegistrationCards($("#km-regs"));
    live.bindLivePage($("#km-page"), nav);
  };
  const paintSearch = () => {
    $("#search-result").innerHTML = searchResult();
    if (isLive()) live.bindSearchResult($("#search-result"), nav);
  };
  // Live updates redraw the parts in place, so typing in the search field keeps its focus.
  const paintParts = () => {
    if (app.dataset.screen !== "kachat-market") return;
    const scroller = app.querySelector(".km");
    const scroll = scroller?.scrollTop || 0;
    $("#km-status").innerHTML = heroStatus();
    $("#km-regs").innerHTML = isLive() ? live.registrationCardsHtml() : "";
    $("#km-page").innerHTML = pageHtml();
    paintSearch();
    bindParts();
    if (scroller) scroller.scrollTop = scroll;
  };

  paint();
  if (kachatLive) {
    live.hub.onChange = paintParts;
    live.hub.start();
  }
}

// --- How it works (sheet) ------------------------------------------------------------------

function showHowItWorks(isLive = false) {
  const rows = [
    ["atPlus", "Claim", "Pick a free name and register it on Kaspa. It's yours: your name in chats, your profile, your link."],
    ["tag", "List", "Set a price. The name waits in an on-chain covenant, not with KaChat or anyone else, until someone buys it or you take it back."],
    ["cart", "Buy", "Pay the listed price. The payment reaches the seller and the name reaches you in the same transaction - both happen, or neither does."],
    ["hand", "Offer", "Name your own price. Your KAS waits on chain until the seller accepts, you withdraw the offer, or it expires - and you can message the seller first."],
    ["shield", "Trustless", "No middleman and no escrow account: Kaspa's own rules enforce every sale."],
  ];
  openPanel({
    title: "How .kachat works",
    trailing: "Done",
    body: `
      <div class="km-card km-how">
        ${rows.map(([icon, title, detail]) => `
          <div class="km-how-row">
            <span class="accent km-how-icon">${SYMBOLS[icon]}</span>
            <span class="tx-meta"><span class="strong small">${esc(title)}</span><span class="muted small">${esc(detail)}</span></span>
          </div>`).join("")}
      </div>
      <p class="form-footer">${isLive ? "Live on Testnet: names, prices and payments here use TKAS on testnet-10. Mainnet names come after an audit." : "Nothing here is live yet."}</p>`,
  });
}

// --- Listing (iOS KachatListingDetailView) --------------------------------------------------

function showListing({ onBack }) {
  const rows = (icon, line, trailing) => `
    <div class="km-row">
      <span class="accent km-icon">${SYMBOLS[icon]}</span>
      ${line}
      ${trailing}
    </div>`;
  render(`
    ${navHeader({ title: "Listing" })}
    <section class="km">
      <div class="km-card km-name-card">
        <div class="km-name-banner">${redact("name.kachat")}</div>
        <div class="km-price-row">
          <div class="tx-meta"><span class="muted tiny">Price</span><span class="km-price">${redact("000 KAS")}</span></div>
          <span class="tiny">${redact("listed 1h ago")}</span>
        </div>
        ${pill()}
      </div>
      <div class="km-actions">
        <button class="km-prominent with-icon" id="buy">${SYMBOLS.cart}<span>Buy Now</span></button>
        <button class="km-bordered with-icon" id="offer">${SYMBOLS.hand}<span>Make an Offer</span></button>
      </div>
      ${header("Seller")}
      <div class="km-card km-seller">
        <span class="km-dot big"></span>
        <span class="tx-meta"><span class="strong small">${redact("kaspa:xxxx....xxxx")}</span><span class="muted tiny">Ask about the name, or agree on a price before you offer.</span></span>
        <button class="km-bordered small-button with-icon" disabled>${SYMBOLS.bubbles}<span>Message</span></button>
      </div>
      ${header("Offers", "Open offers on this name, highest first. The seller can accept any of them.")}
      <div class="km-card km-list">
        ${Array.from({ length: 3 }, () => rows("hand",
          `<span class="tx-meta"><span class="strong small">${redact("kaspa:xxxx....xxxx")}</span><span class="tiny">${redact("expires in 2d")}</span></span>`,
          `<span class="strong small">${redact("000 KAS")}</span>`)).join("")}
      </div>
      ${header("History")}
      <div class="km-card km-list">
        ${["tag", "arrows", "atPlus"].map((icon) => rows(icon,
          `<span class="tx-meta"><span class="small">${redact("listed by kaspa:xxxx")}</span></span>`,
          `<span class="tiny">${redact("3d ago")}</span>`)).join("")}
      </div>
      <div class="km-notes muted small">
        <div>${SYMBOLS.cart}<span>Buying pays the seller and moves the name to you in one transaction.</span></div>
        <div>${SYMBOLS.lock}<span>An offer locks your KAS on chain until the seller accepts it, you withdraw it, or it expires.</span></div>
        <div>${SYMBOLS.bubbles}<span>Messages go to the seller like any KaChat chat.</span></div>
      </div>
    </section>`, "kachat-listing");
  $("#back").onclick = onBack;
  // Buy Now and Make an Offer open their sheets so the flow can be looked at; their final
  // buttons are disabled until names launch.
  $("#buy").onclick = showBuy;
  $("#offer").onclick = showOffer;
}

function summaryRow(title, value, bold = false) {
  return `<div class="form-row between"><span class="${bold ? "strong" : ""}">${esc(title)}</span><span class="${bold ? "strong" : ""}">${redact(value)}</span></div>`;
}

function showBuy() {
  openPanel({
    title: "Buy Name",
    leading: "Cancel",
    full: true, // full height with Cancel top left, like Make an Offer (iOS 6dd5578)
    body: `
      <div class="form-section">
        <div class="form-card">
          ${summaryRow("Name", "name.kachat")}
          ${summaryRow("Price", "000 KAS")}
          ${summaryRow("Network fee", "0.0000 KAS")}
          ${summaryRow("Total", "000 KAS", true)}
        </div>
        <div class="form-footer">The payment reaches the seller and the name reaches you in the same transaction - both happen, or neither does.</div>
      </div>
      <div class="form-section">
        <div class="form-card"><button class="form-row km-form-button" disabled>Confirm Purchase</button></div>
        <div class="form-footer">Buying opens when .kachat names launch.</div>
      </div>`,
  });
}

function showOffer() {
  const expiries = [["1d", "1 Day"], ["3d", "3 Days"], ["7d", "7 Days"], ["30d", "30 Days"]];
  openPanel({
    title: "Make an Offer",
    leading: "Cancel",
    full: true,
    body: `
      <div class="form-section">
        <div class="form-card">
          ${summaryRow("Name", "name.kachat")}
          ${summaryRow("Listed at", "000 KAS")}
        </div>
      </div>
      <div class="form-section">
        <div class="form-header">Your offer</div>
        <div class="form-card"><div class="form-row"><input class="plain-input km-offer-amount" inputmode="decimal" placeholder="0" /><span class="muted">KAS</span></div></div>
        <div class="form-footer">Your KAS stays locked on chain until the seller accepts, you withdraw the offer, or it expires. Nobody else can touch it.</div>
      </div>
      <div class="form-section">
        <div class="form-header">Expires after</div>
        <div class="form-card"><div class="form-row">
          <div class="segmented wide km-expiry" role="radiogroup" aria-label="Expires after">
            ${expiries.map(([id, label]) => `<button type="button" role="radio" data-expiry="${id}" aria-checked="${id === "3d"}">${label}</button>`).join("")}
          </div>
        </div></div>
      </div>
      <div class="form-section">
        <div class="form-card"><button class="form-row km-form-button" disabled>Send Offer</button></div>
        <div class="form-footer">Offers open when .kachat names launch.</div>
      </div>`,
    onMount(panel) {
      // The amount and expiry can be set so the form can be tried, as on iOS.
      for (const option of panel.querySelectorAll("[data-expiry]")) {
        option.onclick = () => {
          for (const other of panel.querySelectorAll("[data-expiry]")) other.setAttribute("aria-checked", String(other === option));
        };
      }
      const amount = panel.querySelector(".km-offer-amount");
      amount.oninput = () => { amount.value = amount.value.replace(/[^\d.]/g, ""); };
    },
  });
}
