// The one .kachat names runtime of the wallet (iOS KachatNamesService.shared /
// KachatNamesRegistry.shared / KachatNamesActions.shared, KaChat-Desktop ui/kachat-names-runtime.js):
// a single service, registry and actions instance, so the .kachat screens, name resolution, Your
// Domains and the profile hero all read the same registry and see the same registrations in flight.
//
// Testnet-10 only (net.js IS_TESTNET). On mainnet everything here answers null and the .kachat
// screens keep their mockups and "Coming soon".
//
// The registry needs no key: it reads the chain walker (or a names indexer) and is shared by name
// lookups. Actions sign with the active account's chatting address - the signer is bound when a
// .kachat screen or the home screen asks for the runtime, and forgotten on lock or account switch.

import { IS_TESTNET } from "./net.js";
import { getEndpoint } from "../shared/engine/endpoints.js";
import { KachatNamesService } from "../shared/engine/kachat-names/service.js";
import { KachatNamesRegistry } from "../shared/engine/kachat-names/registry.js";
import { KachatNamesActions } from "../shared/engine/kachat-names/actions.js";
import { KachatSocialImageResolver } from "../shared/engine/kachat-names/social-image-resolver.js";
import { chattingSigner, namesNodeMethods } from "./wallet.js";

const localStorageAdapter = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage full: the next refresh re-walks */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* nothing to drop */ } },
};

/** Whether .kachat names are live here (testnet-10). */
export const kachatLive = IS_TESTNET;

// The engine object the service and actions hold: the node methods, plus the signer once bound.
// Made on first use (names.js -> here -> wallet.js -> names.js is an import cycle).
let engine = null;
let service = null;
let registry = null;
let actions = null;
let boundAddress = null;

function base() {
  if (!IS_TESTNET) return null;
  if (!service) {
    engine = { ...namesNodeMethods(), kaspa: null, rpc: null, address: null, privateKey: null, privateKeyHex: null };
    service = new KachatNamesService(engine);
    registry = new KachatNamesRegistry({
      manifest: () => service.loadManifest(),
      isEnabled: () => KachatNamesService.isEnabled,
      getUtxosByAddresses: (addresses) => engine.utxosForRegistry(addresses),
      restBase: () => getEndpoint("kaspaApi"),
      indexerBase: () => getEndpoint("kasiaIndexer"),
      storage: localStorageAdapter,
      log: (...parts) => console.info("[KaChat Wallet]", ...parts),
    });
    actions = new KachatNamesActions({ engine, service, registry, storage: localStorageAdapter });
  }
  return { service, registry, actions, engine };
}

/** The shared registry (no key needed), or null on mainnet. */
export function kachatRegistry() {
  return base()?.registry ?? null;
}

/**
 * The runtime with the active account's chatting address bound as the signer:
 * `{ service, registry, actions, engine }`, or null on mainnet. The wallet must be unlocked.
 */
export async function kachatNames() {
  const runtime = base();
  if (!runtime) return null;
  const signer = await chattingSigner();
  const address = signer.address.toLowerCase();
  engine.kaspa = signer.kaspa;
  engine.address = address;
  engine.privateKey = signer.privateKeyHex;
  engine.privateKeyHex = signer.privateKeyHex;
  if (boundAddress !== address) {
    boundAddress = address;
    // Another account: its own registrations in flight (the driver keys them by wallet address).
    actions.resume();
  }
  return runtime;
}

/** Drops the bound key (wallet locked, account removed). The registry and its cache stay. */
export function forgetKachatSigner() {
  if (!engine) return;
  engine.address = null;
  engine.privateKey = null;
  engine.privateKeyHex = null;
  boundAddress = null;
}

/** An address's .kachat label (primary name while active, else its oldest active name), or null. */
export async function kachatLabelOf(address) {
  const reg = kachatRegistry();
  if (!reg || !address) return null;
  try {
    await reg.refreshIfStale({ maxAge: 300 });
    return (await reg.identity(address))?.label || null;
  } catch {
    return null;
  }
}

// --- Social profiles (iOS KachatSocialImageResolver) ---------------------------------------
//
// A .kachat profile's avatar, banner and bio come from social profile links, looked up on this
// device (shared/engine/kachat-names/social-image-resolver.js). The wallet reads the platforms'
// pages directly: its website-connect content scripts already give it access to https sites, so
// nothing more is asked for. An extension can't pick a User-Agent, so the resolver's "crawler"
// hint is not honored: pages answer as they do to a browser (Facebook's profile pictures, which
// it serves only to its own crawler, may not show).

async function fetchText(url, { accept, timeoutMs = 8000, maxBytes = 3_000_000, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort);
  try {
    const response = await fetch(url, {
      headers: accept ? { Accept: accept } : {},
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: controller.signal,
    });
    let text = await response.text();
    if (text.length > maxBytes) text = text.slice(0, maxBytes);
    return { status: response.status, contentType: response.headers.get("content-type") || "", text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

let socialResolver = null;

/** The one resolver of the wallet (its 24 h answers are kept in localStorage). */
export function kachatSocial() {
  if (!socialResolver) {
    socialResolver = new KachatSocialImageResolver({ fetchText, storage: localStorageAdapter });
  }
  return socialResolver;
}

/** This wallet's own profile record (the one it last wrote, else the registry's), or null. */
export async function ownKachatProfile(address) {
  const reg = kachatRegistry();
  if (!reg || !address) return null;
  try {
    const own = (await reg.ownProfile(address))?.profile;
    if (own) return own;
    return (await reg.identity(address))?.profile ?? null;
  } catch {
    return null;
  }
}
