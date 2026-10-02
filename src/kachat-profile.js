// "Edit .kachat Profile" - iOS KaChatProfileEditorSheet, opened from the Profile hero.
//
// Mainnet: the "coming" editor - the layout of the profile editor with nothing in it yet,
// because KaChat's own names are not live there.
// Testnet: the live address profile editor (iOS KachatLiveProfileEditor); it writes the
// kchat:1:profile: record.
//
// Left out on purpose: iOS's Setup Guide row (the wallet has no setup guides).

import { esc, ICONS } from "./ui.js";
import { openPanel } from "./kachat-ui.js";
import { kachatLive } from "./kachat-names.js";

// SF Symbols photo / photo.on.rectangle.
const PHOTO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-7 7"/></svg>';
const PHOTO_STACK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="7" width="16" height="12" rx="2"/><path d="M3 15V5a2 2 0 0 1 2-2h12"/><path d="M21 16l-4-4-6 6"/></svg>';

export function showKachatProfileEditor({ onSaved = () => {} } = {}) {
  if (kachatLive) return showLiveProfileEditor({ onSaved });
  return showComingSoonEditor();
}

function showComingSoonEditor() {
  const row = (label, icon = "") => `<div class="form-row muted">${icon}<span>${esc(label)}</span></div>`;
  const fields = ["Bio", "X handle", "Website", "Telegram", "Discord user id", "Email", "GitHub", "Redirect URL"];
  openPanel({
    title: "Edit .kachat Profile",
    trailing: "Done",
    full: true,
    body: `
      <div class="form-section">
        <div class="form-card"><div class="form-row kp-coming">
          <span class="accent">${ICONS.atCircle}</span>
          <span class="small">.kachat names are coming. Once you claim one, your avatar, banner, bio and links are set here - and they're what KaChat shows for you everywhere.</span>
        </div></div>
      </div>
      <div class="form-section"><div class="form-header">Avatar</div><div class="form-card">${row("Choose Avatar", PHOTO)}</div></div>
      <div class="form-section"><div class="form-header">Banner</div><div class="form-card">${row("Choose Banner", PHOTO_STACK)}</div></div>
      <div class="form-section"><div class="form-header">Profile</div><div class="form-card">${fields.map((f) => row(f)).join("")}</div></div>
      <div class="form-section"><div class="form-header">.kachat Name</div><div class="form-card">
        <div class="form-row between"><span>Name</span><span class="muted">None yet</span></div>
      </div></div>`,
  });
}

// The live editor arrives with the .kachat social-profile port (iOS ad32798..0f44a07).
function showLiveProfileEditor() {
  return showComingSoonEditor();
}
