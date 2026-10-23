// The password before every KAS you send (KaChat-Desktop Build 228, the owner's rule of 2026-10-23,
// without Face ID here: the wallet password). wallet.js asks this before anything is built or a
// node is touched - Send Kaspa, Max, Compound, a spending address's send, .kas transfers, and
// payments approved for websites - so no screen can skip it. Cancelling sends nothing.

import { esc } from "./ui.js";
import * as vault from "./vault.js";

/**
 * "Confirm Send" with what is being sent and to whom. Resolves true once the password checks out,
 * false when cancelled. `details`: { amountText, recipient, max, title }.
 */
export function confirmSpend({ amountText = "", recipient = "", max = false, title = "Confirm Send" } = {}) {
  return new Promise((resolve) => {
    document.querySelector(".spend-auth")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "alert-backdrop spend-auth";
    const what = max ? `Everything${amountText ? ` (${amountText})` : ""}` : amountText;
    const to = recipient ? `${recipient.slice(0, 16)}…${recipient.slice(-6)}` : "";
    backdrop.innerHTML = `
      <form class="alert" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="alert-body">
          <div class="alert-title">${esc(title)}</div>
          <div class="alert-message">${what ? `<strong>${esc(what)}</strong>` : ""}${to ? `<br><span class="mono tiny">to ${esc(to)}</span>` : ""}</div>
          <div class="alert-message">Enter your wallet password to send.</div>
          <input class="alert-field" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" />
          <div class="error spend-auth-error"></div>
        </div>
        <div class="alert-buttons two">
          <button type="button" class="alert-button" data-cancel>Cancel</button>
          <button type="submit" class="alert-button strong">Send</button>
        </div>
      </form>`;
    const done = (ok) => { backdrop.remove(); document.removeEventListener("keydown", onKey); resolve(ok); };
    const onKey = (event) => { if (event.key === "Escape") done(false); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop || event.target.closest("[data-cancel]")) done(false); });
    const input = backdrop.querySelector(".alert-field");
    backdrop.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      if (await vault.verifyPassword(input.value)) return done(true);
      backdrop.querySelector(".spend-auth-error").textContent = "Wrong password.";
      input.select();
    };
    document.body.appendChild(backdrop);
    input.focus();
  });
}
