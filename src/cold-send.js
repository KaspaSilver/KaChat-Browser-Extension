// Send from Cold Storage - iOS ColdSendFlowView: the form, the unsigned build, the animated KSPT
// QR for the KasSigner device (2.5 s a frame), the camera scan of the signed reply, broadcast, and
// the Sent / Something Went Wrong screens. The same flow is Compound UTXOs (the recipient locked
// to the address itself, the largest 32 UTXOs, Max).
//
// No private key is ever involved: the transaction is built unsigned (ui/kspt.js, the same engine
// the desktop app and iOS use), signed on the device, and checked against what was sent for
// signing before it is broadcast.
//
// Fee math (iOS): the reference mass is 1 input / two 34-byte outputs (2036), or the coin-control
// set's own mass; the base rate is the live quote (fetched once) or the 100 sompi/gram floor; the
// default fee is mass x rate; Fast / Priority add 1x / 4x the default on top, a custom fee adds
// what it is above the default (below it adds nothing). The fee shown is the automatic-selection
// preview's exact fee when there is one; the build gets that preview's UTXO set and the same rate,
// so the fee shown and the fee paid are the same number.

import QRCode from "qrcode";
import * as wallet from "./wallet.js";
import { app, esc, render, $, toast, settings, ICONS, formatKas8 } from "./ui.js";
import { otherDomainsHtml, bindOtherDomains, splitTypedName, looksLikeName } from "./names.js";
import { scanQr } from "./camera.js";
import { showCoinControl } from "./send.js";
import { SF, shortAddress } from "./cold-common.js";
import { KAS_UNIT } from "./net.js";
import {
  recipientCardHtml, amountState, amountEntryHtml, fitAmountInput, pillHtml, feeControlsHtml,
  slideButtonHtml, bindSlideButton, trimmedKas,
} from "./send-pieces.js";
import {
  KSPT_MAX_INPUTS, MIN_RELAY_FEE_PER_GRAM, REFERENCE_MASS_FOR_FEE_EDITOR, calculateMass, calculateFee,
  fetchQuotedFeeRateSompiPerGram, previewAutomaticSelection, estimateMaxAmount, compoundInputs,
  buildUnsignedTransaction, unsignedToKsptBytes, chunkQrFrames, QrFrameAccumulator, looksLikeKspt,
  decodeKspt, broadcastSigned,
} from "../shared/ui/kspt.js";

const TIERS = [["normal", "Normal", 1n], ["fast", "Fast", 2n], ["priority", "Priority", 5n]];

/**
 * @param {object} opts
 * @param {string} opts.fromAddress
 * @param {bigint} opts.availableSompi
 * @param {boolean} [opts.compound]
 * @param {Function} opts.onClose   Cancel
 * @param {Function} opts.onDone    Done on the Sent screen (refresh the address)
 */
export function showColdSend(opts) {
  const from = opts.fromAddress;
  const s = {
    step: "form",           // form | building | coins | qr | broadcasting | success | failed
    toInput: opts.compound ? from : "",
    validAddress: Boolean(opts.compound),
    resolving: false,
    resolved: null,         // { address, domain, tld }
    knsError: "",
    resolutions: [],
    othersOpen: false,
    amountText: "",
    maxMode: false,
    estimatingMax: false,
    tier: "normal",
    customExtra: null,      // bigint sompi above the default, or null
    editingFee: false,
    liveRate: null,         // bigint sompi/gram
    preview: null,          // { utxoKeys, feeSompi }
    manualKeys: null,       // coin control / compound's fixed set
    compoundHasMore: false,
    price: null,
    unsigned: null,
    frames: [],
    frameIndex: 0,
    playing: true,
    txid: "",
    error: "",
  };
  // The amount field (KAS or your currency) - iOS KaspaFiatAmountState.
  const amountField = amountState();
  let engine = null;
  const getEngine = async () => (engine ||= await wallet.ksptEngine());
  let closed = false;

  // --- derived ----------------------------------------------------------------------------
  const amountSompi = () => {
    const exact = wallet.kasToSompi(s.amountText);
    if (exact != null) return exact > 0n ? exact : null;
    const kas = Number.parseFloat(s.amountText);
    return Number.isFinite(kas) && kas > 0 ? BigInt(Math.round(kas * 1e8)) : null;
  };
  const effectiveAddress = () => (s.resolved?.address || s.toInput.trim());
  const hasValidRecipient = () => Boolean(s.resolved) || (s.validAddress === true && !s.resolving);
  const canBuild = () => hasValidRecipient() && amountSompi() != null;
  const referenceMass = () => (s.manualKeys?.length ? calculateMass(s.manualKeys.length, [34, 34], 0) : REFERENCE_MASS_FOR_FEE_EDITOR);
  const baseRate = () => s.liveRate ?? MIN_RELAY_FEE_PER_GRAM;
  const defaultFee = () => calculateFee(referenceMass(), baseRate());
  const extraFee = () => (s.customExtra != null ? s.customExtra : defaultFee() * ((TIERS.find((t) => t[0] === s.tier)?.[2] || 1n) - 1n));
  const effectiveFee = () => (!s.manualKeys && s.preview ? s.preview.feeSompi : defaultFee() + extraFee());
  const feeRateOverride = () => {
    if (s.tier === "normal" && s.customExtra == null) return baseRate();
    const mass = referenceMass();
    return (defaultFee() + extraFee() + mass - 1n) / mass;
  };

  // --- preview / max / recipient --------------------------------------------------------------
  let previewTimer = null;
  const schedulePreview = () => {
    clearTimeout(previewTimer);
    s.preview = null;
    const amount = amountSompi();
    if (s.manualKeys || amount == null) return;
    const rate = feeRateOverride();
    previewTimer = setTimeout(async () => {
      const preview = await previewAutomaticSelection({ engine: await getEngine(), fromAddress: from, amountSompi: amount, feeRateSompiPerGram: rate }).catch(() => null);
      if (closed || s.step !== "form" || amountSompi() !== amount || feeRateOverride() !== rate || s.manualKeys) return;
      s.preview = preview;
      paintForm();
    }, 400);
  };

  const setMax = async () => {
    if (!hasValidRecipient() || s.estimatingMax) return;
    s.estimatingMax = true;
    paintForm();
    try {
      const max = await estimateMaxAmount({ engine: await getEngine(), fromAddress: from, feeRateOverride: feeRateOverride(), manualUtxoKeys: s.manualKeys });
      s.amountText = formatKas8(max);
      amountField.setKas(s.amountText, s.price?.price || 0);
      s.maxMode = true;
    } catch { /* the amount stays as it was */ }
    s.estimatingMax = false;
    schedulePreview();
    paintForm();
  };

  // A fee change after Max keeps Max true to the new fee (the amount is the balance less the fee).
  const feeChanged = () => {
    schedulePreview();
    if (s.maxMode) setMax(); else paintForm();
  };

  let resolveSeq = 0;
  const recipientChanged = (raw) => {
    s.toInput = raw;
    s.resolved = null;
    s.knsError = "";
    s.resolving = false;
    s.resolutions = [];
    s.othersOpen = false;
    s.validAddress = false;
    const seq = ++resolveSeq;
    const trimmed = raw.trim();
    if (!trimmed) { paintForm(); return; }
    if (/^kaspa(test)?:/i.test(trimmed)) {
      s.validAddress = null; // checking
      wallet.isValidAddress(trimmed).then((ok) => {
        if (seq !== resolveSeq) return;
        s.validAddress = ok;
        paintForm();
      });
      paintForm();
      return;
    }
    if (looksLikeName(trimmed)) {
      s.resolving = true;
      paintForm();
      setTimeout(async () => {
        if (seq !== resolveSeq) return;
        try {
          const result = await wallet.resolveRecipient(trimmed);
          if (seq !== resolveSeq) return;
          s.resolved = { address: result.address, domain: result.domain, tld: result.tld };
          s.resolutions = result.resolutions || [];
        } catch (error) {
          if (seq !== resolveSeq) return;
          s.knsError = "No domain found";
          s.resolutions = error.resolutions || [];
          // Nothing for the ending typed, but another service has the name: show it straight away.
          s.othersOpen = s.resolutions.some((r) => r.address);
        }
        s.resolving = false;
        paintForm();
      }, 300);
      return;
    }
    paintForm();
  };

  // --- build / sign / broadcast ------------------------------------------------------------
  const build = async () => {
    const amount = amountSompi();
    if (!canBuild() || s.step !== "form") return;
    s.step = "building";
    paintForm();
    try {
      const unsigned = await buildUnsignedTransaction({
        engine: await getEngine(),
        fromAddress: from,
        toAddress: effectiveAddress(),
        amountSompi: amount,
        feeRateOverride: feeRateOverride(),
        manualUtxoKeys: s.manualKeys ?? s.preview?.utxoKeys ?? null,
      });
      if (closed) return;
      s.unsigned = unsigned;
      s.frames = chunkQrFrames(unsignedToKsptBytes(unsigned));
      s.frameIndex = 0;
      s.playing = true;
      s.step = "qr";
      paintQr();
    } catch (error) {
      if (closed) return;
      fail(error);
    }
  };

  const fail = (error) => {
    stopTimer();
    s.step = "failed";
    s.error = String(error?.message || error || "");
    paintResult();
  };

  const scanSigned = async () => {
    const accumulator = new QrFrameAccumulator(looksLikeKspt);
    const bytes = await scanQr({
      title: "Scan Signed Transaction",
      hint: "Point camera at the KasSigner screen",
      onBinaryFrame: (frame) => {
        const complete = accumulator.addFrame(frame);
        const progress = accumulator.progress;
        return { complete, progress: progress ? { ...progress, indices: [...accumulator.receivedFrameIndices] } : null };
      },
    });
    if (closed) return;
    // Cancelled: back to the QR, so the device can be shown it again.
    if (!bytes) return;
    stopTimer();
    s.step = "broadcasting";
    paintResult();
    try {
      const decoded = decodeKspt(bytes);
      const txid = await broadcastSigned({ engine: await getEngine(), unsigned: s.unsigned, decoded });
      if (closed) return;
      s.txid = String(txid || "");
      s.step = "success";
      paintResult();
    } catch (error) {
      if (!closed) fail(error);
    }
  };

  const close = (then) => {
    closed = true;
    stopTimer();
    clearTimeout(previewTimer);
    then();
  };

  // --- the animated QR ----------------------------------------------------------------------
  let timer = null;
  const stopTimer = () => { clearInterval(timer); timer = null; };
  const startTimer = () => {
    stopTimer();
    if (s.frames.length <= 1) return;
    timer = setInterval(() => {
      if (s.step !== "qr" || app.dataset.screen !== "cold-sign") { stopTimer(); return; }
      if (!s.playing || document.querySelector(".scanner")) return;
      s.frameIndex = (s.frameIndex + 1) % s.frames.length;
      drawFrame();
    }, 2500);
  };
  const drawFrame = async () => {
    const canvas = $("#kspt-qr");
    const frame = s.frames[s.frameIndex];
    if (!canvas || !frame) return;
    try {
      await QRCode.toCanvas(canvas, [{ data: frame, mode: "byte" }], {
        errorCorrectionLevel: "M", margin: 1, width: 560, color: { dark: "#000000", light: "#ffffff" },
      });
    } catch (error) {
      console.warn("[KaChat Wallet] KSPT QR failed:", error);
    }
    canvas.style.width = "";
    canvas.style.height = "";
    for (const dot of app.querySelectorAll("[data-dot]")) dot.classList.toggle("on", Number(dot.dataset.dot) === s.frameIndex);
    const counter = $("#frame-counter");
    if (counter) counter.textContent = `Frame ${s.frameIndex + 1} / ${s.frames.length}`;
  };

  // --- painting --------------------------------------------------------------------------------
  const title = opts.compound ? "Compound UTXOs" : "Send from Cold Storage";
  const header = (white = false) => `
    <header class="navbar form-bar ${white ? "cold-white-bar" : ""}">
      <button class="bar-text" id="cancel">Cancel</button>
      <div class="nav-title">${esc(title)}</div>
      <span class="cold-bar-spacer"></span>
    </header>`;
  const bindCancel = () => { $("#cancel").onclick = () => close(opts.onClose); };

  const recipientStatus = () => {
    if (opts.compound || !s.toInput.trim()) return "";
    if (s.resolving) return '<div class="status muted"><span class="spinner small-spin"></span> Looking up domain...</div>';
    if (s.knsError) return `<div class="status bad">${ICONS.xCircle}<span>${esc(s.knsError)}</span></div>`;
    if (s.resolved) return `<div class="status good">${ICONS.checkFill}<span>Resolved: ${esc(s.resolved.domain || "")}</span></div><div class="mono tiny muted ellipsis cold-resolved">${esc(s.resolved.address)}</div>`;
    if (s.validAddress === null) return "";
    return s.validAddress
      ? `<div class="status good">${ICONS.checkFill}<span>Valid address</span></div>`
      : `<div class="status bad">${ICONS.xCircle}<span>Invalid address format</span></div>`;
  };


  function paintForm() {
    if (closed || (s.step !== "form" && s.step !== "building")) return;
    const focusedId = document.activeElement?.id;
    const caret = document.activeElement?.selectionStart;
    const scroll = app.querySelector(".form")?.scrollTop || 0;
    const building = s.step === "building";
    const fee = effectiveFee();
    const price = s.price?.price || 0;
    const fiatFormat = (kas) => (price ? wallet.formatFiat(wallet.kasToSompi(kas.toFixed(8)), s.price) : "");
    const currency = String(s.price?.currency || "usd").toUpperCase();
    render(`
      ${header()}
      <section class="form sk-form cold-send-form">
        <div class="sk-pills">
          ${pillHtml(`<span>From</span><span class="mono">${esc(shortAddress(from))}</span>`)}
          ${pillHtml(`<span>Available</span><span>${esc(trimmedKas(opts.availableSompi))} KAS</span>`)}
        </div>
        ${recipientCardHtml({
          input: s.toInput,
          lockedAddress: opts.compound ? from : null,
          status: {
            resolving: s.resolving,
            error: s.knsError,
            resolvedAddress: s.resolved?.address || null,
            resolvedName: s.resolved?.domain || null,
            valid: s.validAddress === true,
          },
          extraHtml: s.resolutions.length
            ? otherDomainsHtml({ resolutions: s.resolutions, selectedTld: s.resolved?.tld || splitTypedName(s.toInput).tld, open: s.othersOpen })
            : "",
        })}
        ${opts.compound ? `<p class="muted tiny center-text">${s.compoundHasMore
          ? `This address has more than ${KSPT_MAX_INPUTS} UTXOs. KasSigner can sign at most ${KSPT_MAX_INPUTS} inputs per transaction, so this merges the largest ${KSPT_MAX_INPUTS} into one. Run Compound again afterward to keep combining the rest.`
          : "Merges all of this address's UTXOs into a single one, so future sends need fewer inputs."}</p>` : ""}
        ${amountEntryHtml({
          display: amountField.display,
          unit: amountField.fiat ? currency : KAS_UNIT,
          fiat: amountField.fiat,
          conversion: amountField.conversion(price, fiatFormat),
          currencyCode: currency,
          canSwitch: price > 0,
          maxEnabled: hasValidRecipient(),
          estimatingMax: s.estimatingMax,
        })}
        ${feeControlsHtml({
          tier: s.tier,
          custom: s.customExtra != null,
          editing: s.editingFee,
          customText: formatKas8(fee),
          feeText: `~${trimmedKas(fee)} ${KAS_UNIT}`,
          showsCoinControl: !opts.compound,
          coinSummary: s.manualKeys ? `${s.manualKeys.length} UTXO${s.manualKeys.length === 1 ? "" : "s"} selected` : "Automatic",
        })}
        ${slideButtonHtml({ title: "Build Unsigned Transaction", busy: building, enabled: canBuild(), requiresSlide: false })}
      </section>`, "cold-send");
    const form = app.querySelector(".form");
    if (form) form.scrollTop = scroll;
    bindCancel();
    bindSlideButton(app, build);

    const recipient = $("#recipient");
    if (recipient) {
      recipient.oninput = () => recipientChanged(recipient.value);
      recipient.onkeydown = (event) => { if (event.key === "Enter") event.preventDefault(); };
    }
    bindOtherDomains(app, {
      onToggle: () => { s.othersOpen = !s.othersOpen; paintForm(); },
      onPick: (tld) => {
        const pick = s.resolutions.find((r) => r.tld === tld && r.address);
        if (!pick) return;
        s.resolved = { address: pick.address, domain: pick.display, tld: pick.tld };
        s.knsError = "";
        s.othersOpen = false;
        paintForm();
      },
    });
    const paste = $("#paste");
    if (paste) paste.onclick = async () => {
      try {
        recipientChanged((await navigator.clipboard.readText()).trim());
      } catch {
        toast("Clipboard unavailable - paste with ⌘V instead.");
      }
    };
    const scan = $("#scan");
    if (scan) scan.onclick = async () => {
      const code = await scanQr({ title: "Scan QR Code", hint: "Point camera at a QR code" });
      if (!code || closed) return;
      let text = code.trim();
      if (/^kaspa(test)?:/i.test(text)) text = text.split("?")[0];
      recipientChanged(text);
    };

    const amount = $("#amount");
    amount.oninput = () => {
      const cleaned = amount.value.replace(/[^\d.]/g, "");
      if (cleaned !== amount.value) amount.value = cleaned;
      fitAmountInput(amount);
      s.amountText = amountField.onInput(cleaned, price);
      s.maxMode = false;
      schedulePreview();
      // In place: a repaint mid-typing is not needed for these.
      const chip = $("#unit-switch span");
      if (chip) chip.textContent = amountField.conversion(price, fiatFormat) || (amountField.fiat ? KAS_UNIT : currency);
      const buildButton = $("#slide");
      if (buildButton) { buildButton.disabled = !canBuild(); buildButton.classList.toggle("off", !canBuild()); }
      const feeLabel = $("#fee");
      if (feeLabel) feeLabel.firstChild.textContent = `~${trimmedKas(effectiveFee())} ${KAS_UNIT} `;
    };
    const unitSwitch = $("#unit-switch");
    if (unitSwitch) unitSwitch.onclick = () => { amountField.toggle(price); paintForm(); };
    const max = $("#max");
    if (max) max.onclick = setMax;

    const coins = $("#coins");
    if (coins) coins.onclick = async () => {
      let list;
      try {
        list = await wallet.utxos(from);
      } catch (error) {
        toast(error.message || "Could not read this address's UTXOs.");
        return;
      }
      const labels = await wallet.utxoLabels(from).catch(() => ({}));
      if (closed) return;
      s.step = "coins";
      const live = new Set(list.map((c) => c.key));
      showCoinControl({
        coins: list,
        selected: s.manualKeys ? new Set(s.manualKeys.filter((k) => live.has(k))) : null,
        labels,
        onCancel: () => { s.step = "form"; paintForm(); },
        onDone: (selection) => {
          s.manualKeys = selection ? [...selection] : null;
          s.step = "form";
          feeChanged();
        },
      });
    };

    for (const button of app.querySelectorAll("[data-tier]")) {
      button.onclick = () => {
        s.tier = button.dataset.tier;
        s.customExtra = null;
        s.editingFee = false;
        feeChanged();
      };
    }
    const feeButton = $("#fee");
    if (feeButton) feeButton.onclick = () => { s.editingFee = true; paintForm(); $("#custom-fee")?.select(); };
    const feeOk = $("#fee-ok");
    if (feeOk) {
      const commit = () => {
        const kas = Number.parseFloat($("#custom-fee").value);
        s.editingFee = false;
        if (Number.isFinite(kas) && kas >= 0) {
          const total = BigInt(Math.round(kas * 1e8));
          const base = defaultFee();
          // Below the default adds nothing (iOS commitCustomFee).
          s.customExtra = total > base ? total - base : 0n;
          feeChanged();
        } else {
          paintForm();
        }
      };
      feeOk.onclick = commit;
      $("#custom-fee").onkeydown = (event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") { s.editingFee = false; paintForm(); } };
    }

    // Typing must not lose the caret when a repaint lands mid-word.
    if (focusedId) {
      const again = document.getElementById(focusedId);
      if (again && again !== document.activeElement) {
        again.focus();
        if (caret != null && typeof again.setSelectionRange === "function") {
          try { again.setSelectionRange(caret, caret); } catch { /* not a text field */ }
        }
      }
    }
  }

  // The QR step: a white page whatever the theme, as iOS draws every QR meant for a camera.
  function paintQr() {
    if (closed || s.step !== "qr") return;
    const many = s.frames.length > 1;
    render(`
      ${header(true)}
      <section class="cold-sign">
        <div class="cold-sign-rows">
          <div><span>From</span><span class="mono">${esc(shortAddress(from))}</span></div>
          <div><span>Available</span><span>${esc(formatKas8(opts.availableSompi))} KAS</span></div>
          <div><span>Network Fee</span><span>${esc(formatKas8(s.unsigned.feeSompi))} KAS</span></div>
        </div>
        <p class="cold-sign-hint">Scan this on your KasSigner device</p>
        <div class="cold-sign-frame"><canvas id="kspt-qr" width="560" height="560" aria-label="Unsigned transaction QR"></canvas></div>
        ${many ? `
          <div class="cold-frame-dots">${s.frames.map((_, i) => `<span data-dot="${i}" class="${i === s.frameIndex ? "on" : ""}"></span>`).join("")}</div>
          <div class="cold-frame-controls">
            <button class="icon plain" id="frame-prev" aria-label="Previous frame">${SF.backwardFrame}</button>
            <button class="icon plain" id="frame-play" aria-label="${s.playing ? "Pause" : "Play"}">${s.playing ? SF.pauseFill : SF.playFill}</button>
            <button class="icon plain" id="frame-next" aria-label="Next frame">${SF.forwardFrame}</button>
          </div>
          <div class="cold-frame-counter" id="frame-counter">Frame ${s.frameIndex + 1} / ${s.frames.length}</div>` : ""}
        <button class="ios-capsule cold-bold cold-scan-signed" id="scan-signed">Scan Signed Transaction</button>
      </section>`, "cold-sign");
    bindCancel();
    $("#scan-signed").onclick = scanSigned;
    if (many) {
      $("#frame-prev").onclick = () => { s.frameIndex = (s.frameIndex - 1 + s.frames.length) % s.frames.length; drawFrame(); };
      $("#frame-next").onclick = () => { s.frameIndex = (s.frameIndex + 1) % s.frames.length; drawFrame(); };
      $("#frame-play").onclick = () => {
        s.playing = !s.playing;
        const button = $("#frame-play");
        button.innerHTML = s.playing ? SF.pauseFill : SF.playFill;
        button.setAttribute("aria-label", s.playing ? "Pause" : "Play");
      };
    }
    drawFrame();
    startTimer();
  }

  function paintResult() {
    if (closed) return;
    if (s.step === "broadcasting") {
      render(`${header()}<section class="screen center cold-wait"><span class="spinner"></span><p class="muted">Broadcasting...</p></section>`, "cold-send");
      bindCancel();
      return;
    }
    if (s.step === "success") {
      const explorer = wallet.EXPLORERS[wallet.currentExplorer()]?.name || "the explorer";
      render(`
        ${header()}
        <section class="screen cold-result">
          <div class="glass cold-result-card">
            <span class="muted cold-caption">From</span>
            <span class="mono small break">${esc(from)}</span>
            <span class="muted small">Available: ${esc(formatKas8(opts.availableSompi))} KAS</span>
          </div>
          <div class="cold-sent">${SF.checkCircleBig}<span>Sent</span></div>
          <div class="glass cold-result-card">
            <span class="muted cold-caption">To</span>
            <span class="mono small break">${esc(s.toInput.trim())}</span>
          </div>
          <a class="glass cold-result-card cold-txid" href="${esc(wallet.explorerTxUrl(s.txid))}" target="_blank" rel="noopener noreferrer">
            <span class="muted cold-caption">Transaction ID · tap to view in ${esc(explorer)} <span class="accent">${SF.upRightSquare}</span></span>
            <span class="mono small accent ellipsis">${esc(s.txid)}</span>
          </a>
          <div class="spacer"></div>
          <button class="big" id="done">Done</button>
        </section>`, "cold-send");
      bindCancel();
      $("#done").onclick = () => close(opts.onDone);
      return;
    }
    if (s.step === "failed") {
      render(`
        ${header()}
        <section class="screen center cold-failed">
          ${SF.xCircleBig}
          <div class="cold-failed-title">Something Went Wrong</div>
          <p class="muted center-text">${esc(s.error)}</p>
          <button id="again">Try Again</button>
        </section>`, "cold-send");
      bindCancel();
      $("#again").onclick = () => { s.step = "form"; s.error = ""; paintForm(); schedulePreview(); };
    }
  }

  // --- start --------------------------------------------------------------------------------
  paintForm();
  settings().then((st) => wallet.price(st.currency || "usd")).then((price) => {
    s.price = price;
    if (!closed && s.step === "form" && document.activeElement?.id !== "amount") paintForm();
  }).catch(() => {});
  (async () => {
    // Fetched once and used everywhere the fee is worked out (form, QR step, build).
    s.liveRate = await fetchQuotedFeeRateSompiPerGram();
    if (closed) return;
    if (opts.compound) {
      try {
        const { utxoKeys, hasMore } = await compoundInputs({ engine: await getEngine(), fromAddress: from });
        if (closed) return;
        s.manualKeys = utxoKeys;
        s.compoundHasMore = hasMore;
        await setMax();
      } catch (error) {
        if (!closed) fail(error);
      }
    } else {
      schedulePreview();
      paintForm();
    }
  })();
}
