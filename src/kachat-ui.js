// Pieces the .kachat screens share: the marketplace's SF Symbols, the wordmark and the iOS sheet
// with its own navigation bar (market.js mockups, kachat-live.js live screens).

import { esc, unitText } from "./ui.js";

// SF Symbols used by the marketplace, drawn to match.
export const SYMBOLS = {
  clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M12 7v5.2l3.4 2"/></svg>',
  arrowDownDoc: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3.5H7.4A1.9 1.9 0 0 0 5.5 5.4v13.2a1.9 1.9 0 0 0 1.9 1.9h9.2a1.9 1.9 0 0 0 1.9-1.9V8Z"/><path d="M14 3.5V8h4.5"/><path d="M12 10.5v6.5M9.2 14.2 12 17l2.8-2.8"/></svg>',
  hourglass: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M7.5 3.5c0 4.2 4.5 5.6 4.5 8.5s-4.5 4.3-4.5 8.5M16.5 3.5c0 4.2-4.5 5.6-4.5 8.5s4.5 4.3 4.5 8.5"/></svg>',
  tag: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/></svg>',
  cart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h3l2.5 12h11L21 7H6"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>',
  at: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>',
  arrows: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7"/></svg>',
  atPlus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="12" r="3.5"/><path d="M13.5 8.5v4.5a2.5 2.5 0 0 0 4.5 1.5M17 15.5a8.5 8.5 0 1 1 1.5-7"/><path d="M20 2.5v5M17.5 5h5"/></svg>',
  hand: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.7 15.6a1.6 1.6 0 0 1 2.4-2.1L8 15"/></svg>',
  shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  question: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.2 9.2a3 3 0 0 1 5.6 1.3c0 2-2.8 2.5-2.8 4"/><circle cx="12" cy="17.6" r=".8" fill="currentColor"/></svg>',
  lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  bubbles: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h8A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H8l-3.5 3V13A2.5 2.5 0 0 1 3 10.5z"/><path d="M19 8.5a2 2 0 0 1 2 2v5a2 2 0 0 1-1.5 2V21l-3.2-2.5H11a2 2 0 0 1-2-2"/></svg>',
  // the live screens (testnet)
  sliders: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  calendarPlus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7"/><path d="M3 10h18M8 3v4M16 3v4M18 15v6M15 18h6"/></svg>',
  calendarClock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 11V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="17.5" cy="17.5" r="4"/><path d="M17.5 15.8v1.9l1.2.8"/></svg>',
  hammer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6l4 4M12.5 4.5l3-2 6 6-2 3"/><path d="M15 9L4 20a1.5 1.5 0 0 1-2-2L13 7"/></svg>',
  tagSlash: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><path d="M2 2l20 20"/></svg>',
  renew: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
  release: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  reclaim: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l3.5 6h-7z"/><path d="M5.5 20L2 14h7"/><path d="M18.5 20L22 14h-7"/><path d="M8 9l-3 5M16 9l3 5M9 20h6"/></svg>',
  seal: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22.5l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z"/><path d="M8 12.2l2.6 2.6L16.2 9" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alertCircle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6" stroke="#000" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1.3" fill="#000"/></svg>',
  warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5L1.5 21h21z"/><path d="M12 9.5v5" stroke="#000" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.2" fill="#000"/></svg>',
  ellipsisCircle: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="7.5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="12" r="1.1" fill="currentColor" stroke="none"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/></svg>',
  personFill: '<svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 14a8 8 0 0 1-6-2.7c.9-2 3.3-3.3 6-3.3s5.1 1.3 6 3.3A8 8 0 0 1 12 20z"/></svg>',
  primary: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="8" r="4"/><path d="M2.5 21a7.5 7.5 0 0 1 12-6"/><path d="M15 18.5l2.2 2.2L22 16"/></svg>',
  sent: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.4l3 3 6-6.3" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** The ".kachat" wordmark (iOS KachatTabIcon): heavy rounded type in the accent colour. */
export function kachatWordmark(side) {
  return `<span class="kachat-wordmark" style="font-size:${Math.round(side * 0.62)}px;height:${side}px">.kachat</span>`;
}

/** An iOS sheet with its own navigation bar: Cancel on the left or Done on the right. */
/** `stack`: open over the sheet already showing (a confirmation over an editor) instead of replacing it. */
export function openPanel({ title, leading = null, trailing = null, body, onMount = null, onClose = null, full = false, stack = false }) {
  if (!stack) document.querySelector(".panel-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "panel-backdrop";
  backdrop.innerHTML = `
    <div class="panel ${full ? "full" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grabber"></div>
      <header class="panel-bar">
        ${leading ? `<button class="bar-text" data-close>${esc(leading)}</button>` : "<span></span>"}
        <div class="nav-title">${esc(title)}</div>
        ${trailing ? `<button class="bar-text strong" data-close>${esc(trailing)}</button>` : "<span></span>"}
      </header>
      <div class="panel-body form">${unitText(body)}</div>
    </div>`;
  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  // Escape closes the topmost sheet only.
  const onKey = (event) => { if (event.key === "Escape" && [...document.querySelectorAll(".panel-backdrop")].pop() === backdrop) close(); };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-close]")) close();
  });
  document.body.appendChild(backdrop);
  const panel = backdrop.querySelector(".panel");
  onMount?.(panel);
  return {
    panel,
    close,
    isOpen: () => backdrop.isConnected,
    /** Replaces the bar's buttons (a sheet whose Cancel becomes Done once its job is done). */
    setBar({ leading: nextLeading = null, trailing: nextTrailing = null }) {
      const bar = panel.querySelector(".panel-bar");
      bar.firstElementChild.outerHTML = nextLeading ? `<button class="bar-text" data-close>${esc(nextLeading)}</button>` : "<span></span>";
      bar.lastElementChild.outerHTML = nextTrailing ? `<button class="bar-text strong" data-close>${esc(nextTrailing)}</button>` : "<span></span>";
    },
  };
}

/**
 * A half sheet of square tiles, three to a row - an icon over a short title (iOS ActionSheetTiles
 * / ActionSheetRow; the row's subtitle is the tile's tooltip, iOS's VoiceOver hint).
 *   tiles: [{ title, subtitle, icon, tint: "danger"|null, disabled, onClick }]
 * Picking a tile closes the sheet first, then runs it.
 */
export function showTileSheet({ title, note = "", tiles }) {
  document.querySelector(".tile-sheet-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop tile-sheet-backdrop";
  backdrop.innerHTML = `
    <div class="sheet tile-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grabber"></div>
      <div class="tile-sheet-head"><div class="strong">${esc(title)}</div>${note ? `<div class="muted tiny">${esc(note)}</div>` : ""}</div>
      <div class="tiles">
        ${tiles.map((t, i) => `
          <button class="tile ${t.tint === "danger" ? "tile-danger" : ""}" data-tile="${i}" title="${esc(t.subtitle || "")}" aria-label="${esc(t.title)}" ${t.disabled ? "disabled" : ""}>
            <span class="tile-icon">${t.icon}</span>
            <span class="tile-title">${esc(t.title)}</span>
          </button>`).join("")}
      </div>
    </div>`;
  const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) return close();
    const tile = event.target.closest("[data-tile]");
    if (!tile || tile.disabled) return;
    close();
    tiles[Number(tile.dataset.tile)]?.onClick?.();
  });
  document.body.appendChild(backdrop);
  return { close };
}
