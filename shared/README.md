# shared/

Copies of KaChat-Desktop files the wallet is built on. Don't edit them here: change them in
KaChat-Desktop, then `npm run sync-shared` and commit with the KaChat-Desktop commit in the
message.

| Folder | What |
|---|---|
| `engine/` | The desktop app's wallet engine: key derivation, transactions and signing, wRPC nodes, REST endpoints, KNS, prices, network (mainnet / testnet-10). Only the files the extension imports. |
| `ui/` | `kspt.js` (KasSigner KSPT: unsigned transactions, animated QR frames, signed-transaction scan-back and broadcast) and the BIP39 English word list. |
| `kaspa/` | The rusty-kaspa WASM SDK (`kaspa.js`, `kaspa_bg.wasm`, ISC licence), prebuilt. KaChat-Desktop's `npm run setup:wasm` rebuilds it from rusty-kaspa source. |

Copied from KaChat-Desktop aeec9d3.
