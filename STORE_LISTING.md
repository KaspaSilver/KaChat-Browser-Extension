# KaPay Extension - store listing and review answers

Everything the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons (AMO) forms ask for,
ready to paste. Build the upload files with `npm run package` (see README.md).

| Store | Upload | Developer dashboard |
|---|---|---|
| Chrome Web Store (also Brave, Opera, Vivaldi, Arc) | `packages/kapay-extension-<version>-chromium.zip` | https://chrome.google.com/webstore/devconsole |
| Microsoft Edge Add-ons | the same chromium zip | https://partner.microsoft.com/dashboard/microsoftedge |
| Firefox Add-ons | `kapay-extension-<version>-firefox.zip`, plus `kapay-extension-<version>-source.zip` when asked for source code | https://addons.mozilla.org/developers/ |

Privacy policy URL (all stores): **https://kachat.app/wallet-privacy.html** - live once the
kachat.app link site is redeployed with `web_site/wallet-privacy.html` (KaChat repo).

## Listing

**Name:** KaPay Extension

**Summary (Chrome, max 132 characters):**
KaPay, the Kaspa wallet from KaChat. Send and receive KAS, manage addresses and domains, and connect to Kaspa websites.

**Category:** Chrome: Productivity > Tools (or "Workflow & Planning"; there is no finance category).
Firefox: Privacy & Security is wrong for this - use "Other". Edge: Productivity.

**Description:**

KaPay brings the wallet from the KaPay and KaChat apps to your browser. Your recovery phrase opens
the same addresses as KaPay on iPhone and KaChat on iPhone, Android and desktop.

- Create a new account or import one from KaChat, KasWare, Kaspium, Kastle, KDX, OKX, OneKey,
  Ledger or the Kaspa CLI wallet
- Send and receive Kaspa, with .kas name lookup, Max, coin control and Normal / Fast / Priority fees
- A fresh receiving address every time, and Manage Addresses for your spending addresses:
  generate, discover, rename, hide, set the primary, and send everything to it
- History, coins (UTXOs) and Compound for every address
- Your domains on every Kaspa name service (.kas, .k, .kaspa), with .kachat names on the way:
  set your primary .kas name and send a .kas domain to someone else
- Send to a name on any service - and pick another service's answer under "Other domains"
- Cold Storage: watch a KasSigner account by its kpub and send from it by signing on the device - the transaction goes out and the signature comes back as animated QR codes
- Portfolio: up to five portfolios of buys and sells, price and value charts, profit and loss, network hashrate, CSV import/export, and import from any Kaspa address
- Several accounts in one wallet
- Connect to Kaspa websites: they ask, you approve every connection, payment and signature
- Your recovery phrase is encrypted with your password and never leaves your computer
- No accounts, no tracking, no ads

KaPay is self-custody: only you hold your keys. Keep your recovery phrase written down and
safe - it is the only way to restore your wallet.

## Chrome Web Store: Privacy practices tab

**Single purpose:** A Kaspa cryptocurrency wallet: hold keys locally, show balances, send and
receive Kaspa, manage KNS domains, and let Kaspa websites request payments and signatures with
the user's approval.

**Permission justifications:**

- `storage` - Stores the password-encrypted wallet (recovery phrases), account names, derived
  public addresses, settings and connected websites in the browser.
- `alarms` - Locks the wallet automatically after the auto-lock time the user chooses, and
  schedules the clipboard clear below.
- `offscreen`, `clipboardWrite` - 30 seconds after the user copies their recovery phrase or a
  private key, an offscreen page clears the clipboard (the popup has closed by then). Chrome / Edge
  only; Firefox has no offscreen pages, so there the wallet tells the user to clear it themselves.
- Host permissions `kachat.duckdns.org`, `tnkachat.duckdns.org` - KaChat's own indexer: reads the
  public KaChat profile (avatar, banner and bio links, Linktree, .kachat name) of the user's own
  chatting address for the Profile screen, and .kachat names on testnet. The request carries that
  public address.
- Host permission `api.kaspa.org` - Kaspa REST API: transaction history and address usage.
- Host permissions `*.kaspa.green`, `*.kaspa.red`, `*.kaspa.stream`, `*.kaspa.blue`, `*.kaspa.ws` -
  the public Kaspa node resolver and nodes, for balances and sending transactions.
- Host permissions `api-tn10.kaspa.org`, `api-tn10.dotk.name` - the testnet-10 REST API and .k name service, used only when the user turns on Testnet in Settings.
- Host permission `api.knsdomains.org` - Kaspa Name Service: the .kas domains an address owns,
  name lookups, setting the primary domain.
- Host permissions `api.dotk.name`, `kaspaname.com` - the .k (dotk) and .kaspa (Kaspa Names)
  name services, read-only: the names an address owns and name lookups.
- Host permission `api.coingecko.com` - the Kaspa price in the user's currency and the Portfolio's price history.
- Host permissions `api.gateio.ws`, `query1.finance.yahoo.com` - Portfolio: long-range KAS price history (fallback) and the comparison charts (VOO, gold, silver).
- Content scripts on `https://*/*` (and localhost) - provide `window.kachat`, the interface Kaspa
  websites use to ask the wallet for a connection, payment or signature. The scripts only relay
  those requests; they do not read or change page content, and the wallet uses this access for
  nothing else. Every request needs the user's approval in the wallet.
- Optional host permissions `x.com`, `api.fxtwitter.com`, `www.youtube.com`, `discord.com`,
  `api.github.com`, `t.me`, `www.twitch.tv`, `www.instagram.com`, `www.tiktok.com`,
  `www.facebook.com`, `www.linkedin.com` - requested only when the user taps Allow in Edit KaChat
  Profile: the wallet reads the public profile pages the user linked, to show that profile's
  picture, banner or bio. Nothing is read from those sites until then.
- Optional host permission `https://*/*` - requested only when the user sets a custom Kaspa REST
  API in Settings, for that one address.

**Remote code:** No. All code, including the Kaspa WebAssembly module, is in the package.
(`wasm-unsafe-eval` in the CSP lets the bundled WebAssembly compile; nothing is fetched and run.)

**Data usage:** Category: "Financial and payment information" (public blockchain addresses).
Public Kaspa addresses are sent to the Kaspa network and the APIs above to show balances and send
transactions, and the user's chatting address is sent to KaChat's indexer (`kachat.duckdns.org`)
to read its public KaChat profile. Nothing else is sent, nothing is stored about the user, and
the address is not sold, not used for unrelated purposes and not used for creditworthiness.
Like any web request, these services see the user's IP address.

## Firefox Add-ons

- **Add-on ID:** `wallet@kachat.app` (in the Firefox manifest; do not change it after the first
  upload).
- **Minimum Firefox:** 128 (needs `world: "MAIN"` content scripts and `storage.session`).
- **Data collection declaration:** `financialAndPaymentInfo` (required: public Kaspa addresses go
  to the Kaspa APIs and nodes, and the chatting address to KaChat's indexer for its profile), in
  the manifest's `data_collection_permissions`.
- **Source code:** AMO asks for it because the upload is bundled/minified. Upload the source zip
  and paste these build notes:

  > Requirements: Node.js 20+ and npm. From the repository root: `npm install`, then
  > `npm run package`. The Firefox build is `dist-firefox/`; the zip is
  > `packages/kapay-extension-<version>-firefox.zip`. `shared/kaspa/kaspa.js` and
  > `shared/kaspa/kaspa_bg.wasm` are a build of the rusty-kaspa WASM SDK (ISC licence) version
  > 2.0.1 from a rusty-kaspa master snapshot with covenant support, committed prebuilt (web
  > target, `wasm/build-web --sdk`, rustc commit 59807616e1fa2540724bfbac14d7976d7e4a3860,
  > wasm-bindgen 0.2.100). SHA-256 of `kaspa_bg.wasm`:
  > c1768cd48dfeafb2b07077fa21700075370696e76ab9c180376c32cef8cac80d (`shared/kaspa/SHA256SUMS`;
  > check with `cd shared/kaspa && shasum -a 256 -c SHA256SUMS`). `kaspa.js` is the generated
  > glue with three small local patches that answer the SDK's three built-in JavaScript snippets
  > without `new Function` (the extension's CSP has no 'unsafe-eval'). `shared/kaspa/VERSION`
  > records its provenance: the source is pinned by rebuild to kaspanet/rusty-kaspa master
  > 7de0d4ac4013b2081f3c3c924109a8f2e7824432 (rustc 1.95.0, wasm-pack 0.15.0 / binaryen 117), and
  > KaChat-Desktop's `tools/build-kaspa-wasm.sh` (Docker) rebuilds it: the rebuilt `kaspa.js` glue
  > is byte-identical to the original; the rebuilt `.wasm` differs by 92 bytes of code layout
  > (function order), which `shared/kaspa/VERSION` explains.

## Screenshots

Stores want 1280x800 (Chrome) or at least 600px wide (Firefox). Open the wallet as a tab
(the expand button) at that window size and capture: the Profile home screen, Send Kaspa, Manage
Addresses, Your Domains, and a website approval window.
