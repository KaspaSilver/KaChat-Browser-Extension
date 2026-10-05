// "Edit KaChat Profile" - iOS KaChatProfileEditorSheet, opened from the Profile hero: the live
// address profile editor (iOS KachatLiveProfileEditor) on both networks. It writes the
// kchat:1:profile: record, a self-send that needs no registry, so it saves on mainnet too; only
// the primary name waits for mainnet's registry (iOS d36fc42).
//
// Left out on purpose: iOS's Setup Guide row (the wallet has no setup guides).

import { esc, ICONS } from "./ui.js";
import { openPanel } from "./kachat-ui.js";
import { kachatLaunched, kachatProfiles, kachatSocial, ownKachatProfile } from "./kachat-names.js";
import { openProfileSaveSheet } from "./kachat-live.js";
import { Profile, SocialKind, SocialPlatform, SocialSource } from "../shared/engine/kachat-names/registry-state.js";
import { KachatNamesRegistry } from "../shared/engine/kachat-names/registry.js";

export function showKachatProfileEditor({ onSaved = () => {} } = {}) {
  return showLiveProfileEditor({ onSaved });
}

// --- The live editor (iOS KachatLiveProfileEditor, KachatSocialPreview, KachatSourceInput) ---
//
// The address profile (KACHAT_NAMES.md section 7): where the avatar, banner and bio come from (a
// social profile link each - they can be different accounts), a Linktree link, and which of your
// names labels you - written as a kchat:1:profile: self-transfer. No free text and no uploads:
// what shows comes from a platform that moderates it. A field is saved only once its lookup found
// what it shows, so what gets saved is what was reviewed.

const KINDS = [SocialKind.avatar, SocialKind.banner, SocialKind.bio];
const KIND_TITLES = { avatar: "Avatar", banner: "Banner", bio: "Bio" };
const PERSON_TEXT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="11" r="2.2"/><path d="M4.8 17a3.6 3.6 0 0 1 6.4 0M14 9.5h5M14 13h5"/></svg>';
const NO_PERSON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="8" r="4"/><path d="M2.5 21a7.5 7.5 0 0 1 12-6M19 14v4M19 21v.01"/></svg>';
const NO_WIFI = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 16-2.5M5 12a10 10 0 0 1 9-2.6M8.5 15.5a5 5 0 0 1 4-1.2"/><path d="M20 10v6M20 19.5v.01"/></svg>';

const sourceOf = (field, kind) => SocialSource.from(field.platform, field.handle, kind);
const isEmpty = (field) => !field.handle.trim();
const isBad = (field, kind) => !isEmpty(field) && !sourceOf(field, kind);

/** The source when the handle field holds a whole pasted link (rather than a handle). */
function pastedSource(field, kind) {
  const t = field.handle.trim();
  if (!(t.toLowerCase().startsWith("http") || (t.includes(".") && t.includes("/")))) return null;
  return sourceOf(field, kind);
}

function storedField(link, kind) {
  const s = link ? SocialSource.fromLink(link, kind) : null;
  return s ? { platform: s.platform, handle: s.displayHandle } : { platform: "x", handle: "" };
}

function showLiveProfileEditor({ onSaved }) {
  const resolver = kachatSocial();
  const fields = {};
  for (const kind of KINDS) fields[kind] = { platform: "x", handle: "", lookup: "none", resolved: null, key: "", timer: null };
  const state = { linktree: "", primary: "", activeNames: [], loaded: false, error: null };
  let handle = null;
  let panel = null;

  const badLinktree = () => Boolean(state.linktree.trim()) && Profile.linktreeLinkFromUsername(state.linktree) == null;
  const notReviewed = (kind) => !isEmpty(fields[kind]) && fields[kind].lookup !== "found";
  const blocked = () => KINDS.some((k) => isBad(fields[k], k) || notReviewed(k)) || badLinktree();

  const profile = () => new Profile({
    avatar: sourceOf(fields.avatar, SocialKind.avatar)?.link ?? null,
    banner: sourceOf(fields.banner, SocialKind.banner)?.link ?? null,
    bio: sourceOf(fields.bio, SocialKind.bio)?.link ?? null,
    linktree: Profile.linktreeLinkFromUsername(state.linktree),
    primaryName: state.primary || null,
  }).sanitized();

  // --- one field's preview (KachatSocialPreview) ---

  const previewHtml = (kind) => {
    const field = fields[kind];
    const source = sourceOf(field, kind);
    if (!source) return "";
    const name = SocialPlatform.displayName(source.platform);
    if (field.lookup === "none" || field.lookup === "looking") {
      return '<div class="form-row kp-preview"><span class="spinner small-spin"></span><span class="muted small">Looking up the profile...</span></div>';
    }
    if (field.lookup === "found") {
      const piece = field.resolved?.piece(kind);
      const shown = kind === SocialKind.avatar
        ? `<img class="kp-avatar" src="${esc(piece)}" alt="" referrerpolicy="no-referrer" />`
        : kind === SocialKind.banner
          ? `<div class="fit-banner kp-banner" style="--placeholder: 90px"><img src="${esc(piece)}" alt="" referrerpolicy="no-referrer" /></div>`
          : `<span class="small">${esc(piece)}</span>`;
      return `<div class="form-row kp-preview kp-found">${shown}<span class="muted tiny strong">From ${esc(name)}</span></div>`;
    }
    if (field.lookup === "empty") {
      return `<div class="form-row kp-preview muted">${NO_PERSON}<span class="small">No ${esc(kind)} on this ${esc(name)} profile.</span></div>`;
    }
    return `
      <div class="form-row kp-preview muted">
        ${NO_WIFI}<span class="small kp-grow">Couldn't reach ${esc(name)}.</span>
        <button class="bar-text strong" data-retry="${kind}">Retry</button>
      </div>`;
  };

  const paintPreview = (kind) => {
    if (!handle?.isOpen()) return;
    const host = panel.querySelector(`[data-preview="${kind}"]`);
    host.innerHTML = previewHtml(kind);
    host.querySelector("[data-retry]")?.addEventListener("click", () => lookup(kind, 0));
    const note = panel.querySelector(`[data-bad="${kind}"]`);
    note.hidden = !isBad(fields[kind], kind);
    paintSave();
  };

  /** Debounced: one lookup once typing pauses. Only the latest lookup may land. */
  const lookup = (kind, delay = 500) => {
    const field = fields[kind];
    clearTimeout(field.timer);
    const source = sourceOf(field, kind);
    const key = `${source?.link ?? ""}#${Date.now()}`;
    field.key = key;
    if (!source) { field.resolved = null; field.lookup = "none"; paintPreview(kind); return; }
    field.lookup = "looking";
    paintPreview(kind);
    field.timer = setTimeout(async () => {
      if (field.key !== key) return;
      const result = await resolver.resolve(source);
      if (field.key !== key) return;
      field.resolved = result.profile ?? null;
      const piece = field.resolved?.piece(kind) ?? null;
      field.lookup = result.kind === "answered" ? (piece == null ? "empty" : "found") : (piece == null ? "unreachable" : "found");
      paintPreview(kind);
      if (field.lookup === "found") fillEmpty(field);
    }, delay);
  };

  /** Once one field's account is found, the empty fields take the same account where its platform
   *  can fill them - one handle sets up the whole profile, and each stays editable. */
  const fillEmpty = (from) => {
    for (const kind of KINDS) {
      const field = fields[kind];
      if (field === from || !isEmpty(field) || !SocialPlatform.choices(kind).includes(from.platform)) continue;
      field.platform = from.platform;
      field.handle = from.handle;
      syncInputs(kind);
      lookup(kind, 0);
    }
  };

  const syncInputs = (kind) => {
    const field = fields[kind];
    panel.querySelector(`[data-platform="${kind}"]`).value = field.platform;
    panel.querySelector(`[data-prefix="${kind}"]`).textContent = SocialPlatform.prefix(field.platform);
    const input = panel.querySelector(`[data-handle="${kind}"]`);
    input.value = field.handle;
    input.placeholder = field.platform === "discord" ? "invite" : "handle";
  };

  const sourceSection = (kind) => `
    <div class="form-section">
      <div class="form-header">${KIND_TITLES[kind]}</div>
      <div class="form-card">
        <label class="form-row between"><span>Account on</span>
          <select class="kp-select" data-platform="${kind}">
            ${SocialPlatform.choices(kind).map((p) => `<option value="${p}">${esc(SocialPlatform.displayName(p))}</option>`).join("")}
          </select>
        </label>
        <div class="form-row kp-handle-row">
          <span class="muted" data-prefix="${kind}">${esc(SocialPlatform.prefix("x"))}</span>
          <input class="plain-input" data-handle="${kind}" placeholder="handle" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div data-preview="${kind}"></div>
      </div>
      <div class="form-footer error-text" data-bad="${kind}" hidden>That doesn't look like a handle on this platform.</div>
    </div>`;

  const saveFooter = () => (state.error
    ? `<span class="error-text">${esc(state.error)}</span>`
    : "Saving writes your profile to the chain from your address to itself, for a network fee. Profiles are public.");

  const paintSave = () => {
    if (!handle?.isOpen()) return;
    const button = panel.querySelector("#kp-save");
    button.disabled = !state.loaded || blocked();
    panel.querySelector("#kp-save-footer").innerHTML = saveFooter();
    const linkFooter = panel.querySelector("#kp-link-footer");
    linkFooter.className = `form-footer ${badLinktree() ? "error-text" : ""}`;
    linkFooter.textContent = badLinktree()
      ? "Enter your Linktree username: letters, numbers, dots, dashes or underscores."
      : "Add your Linktree to point people to your other accounts and websites.";
  };

  const paintPrimary = () => {
    const select = panel.querySelector("#kp-primary");
    if (!select) return;
    select.innerHTML = `<option value="">None</option>${state.activeNames.map((n) => `<option value="${esc(n)}">${esc(n)}.kachat</option>`).join("")}`;
    select.value = state.primary;
  };

  // Save confirms on the save sheet with the network fee (iOS 7e238e5); once it is sent the
  // editor closes with it.
  const save = () => openProfileSaveSheet({
    title: "Save Profile", confirmTitle: "Save Profile", doneTitle: "Profile saved",
    makeProfile: async () => profile(),
    onSaved: () => { handle.close(); onSaved(); },
  });

  handle = openPanel({
    title: "Edit KaChat Profile",
    leading: "Cancel",
    full: true,
    body: `
      <div class="form-section">
        <div class="form-card"><div class="form-row kp-coming">
          <span class="accent">${PERSON_TEXT}</span>
          <span class="small">Your profile belongs to your address, not to a name: it stays the same when you buy, sell or let a name go.</span>
        </div></div>
        <div class="form-footer">Each piece comes from a social profile you link, exactly as that platform shows it, so its moderation applies here too. You can use one account for all three, or mix them.</div>
      </div>
      ${KINDS.map(sourceSection).join("")}
      <div class="form-section">
        <div class="form-header">Links</div>
        <div class="form-card"><div class="form-row kp-handle-row">
          <span class="muted">linktr.ee/</span>
          <input class="plain-input" id="kp-linktree" placeholder="username" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div></div>
        <div class="form-footer" id="kp-link-footer"></div>
      </div>
      <div class="form-section">
        <div class="form-header">.kachat Name</div>
        <div class="form-card">${kachatLaunched
          ? '<label class="form-row between"><span>Primary name</span><select class="kp-select" id="kp-primary"></select></label>'
          : '<div class="form-row between"><span>Primary name</span><span class="muted">Coming soon</span></div>'}</div>
        <div class="form-footer">${kachatLaunched
          ? "KaChat shows you by your primary name while you own it and it's active; otherwise by your oldest active name, or your address."
          : ".kachat names aren't on mainnet yet. Your avatar, banner, bio and links save now; you can pick a primary name once names launch."}</div>
      </div>
      <div class="form-section">
        <div class="form-card"><button class="form-row km-form-button" id="kp-save" disabled>Save Profile</button></div>
        <div class="form-footer" id="kp-save-footer"></div>
      </div>`,
  });
  panel = handle.panel;

  for (const kind of KINDS) {
    const select = panel.querySelector(`[data-platform="${kind}"]`);
    const input = panel.querySelector(`[data-handle="${kind}"]`);
    select.onchange = () => { fields[kind].platform = select.value; syncInputs(kind); lookup(kind); };
    input.oninput = () => {
      const field = fields[kind];
      field.handle = input.value;
      // A whole pasted link: switch the picker to its platform, keep the handle.
      const pasted = pastedSource(field, kind);
      if (pasted) {
        field.platform = pasted.platform;
        field.handle = pasted.displayHandle;
        syncInputs(kind);
      }
      lookup(kind);
    };
  }
  const linktree = panel.querySelector("#kp-linktree");
  linktree.oninput = () => { state.linktree = linktree.value; paintSave(); };
  const primary = panel.querySelector("#kp-primary");
  if (primary) primary.onchange = () => { state.primary = primary.value; };
  panel.querySelector("#kp-save").onclick = save;
  paintPrimary();
  paintSave();

  (async () => {
    try {
      const rt = await kachatProfiles();
      const address = rt.actions.myAddress;
      if (kachatLaunched) await rt.registry.refreshIfStale();
      const p = await ownKachatProfile(address);
      if (p) {
        for (const kind of KINDS) {
          Object.assign(fields[kind], storedField(p[kind], kind));
          syncInputs(kind);
          if (!isEmpty(fields[kind])) lookup(kind, 0);
        }
        state.linktree = Profile.linktreeUsername(p.linktree);
        linktree.value = state.linktree;
      }
      const key = kachatLaunched ? KachatNamesRegistry.keyOf(address) : null;
      if (key) state.activeNames = (await rt.registry.namesOf(key, { includeInactive: false })).map((n) => n.name);
      if (p?.primaryName && state.activeNames.includes(p.primaryName)) state.primary = p.primaryName;
    } catch (error) {
      state.error = String(error?.message || error);
    }
    state.loaded = true;
    if (handle.isOpen()) { paintPrimary(); paintSave(); }
  })();
}
