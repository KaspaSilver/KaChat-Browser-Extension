// Refreshes shared/ from a KaChat-Desktop checkout. The wallet's engine (addresses, signing,
// nodes, KNS, prices), the KasSigner KSPT code and the Kaspa WASM SDK are KaChat-Desktop's;
// this repo carries copies so it builds on its own. Run it when the desktop engine changes,
// then build, test and commit shared/ with the commit it came from in the message.
//
//   npm run sync-shared [-- /path/to/KaChat-Desktop]     (default: ../KaChat-Desktop)
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const desktop = resolve(process.argv[2] || `${root}../KaChat-Desktop`);
if (!existsSync(`${desktop}/engine/wallet.js`)) {
  console.error(`No KaChat-Desktop checkout at ${desktop} - pass its path.`);
  process.exit(1);
}
let copied = 0;
for (const dir of ["engine", "ui", "kaspa"]) {
  // Only the files already here: the extension uses a subset of each folder. A new engine
  // import needs its file copied in by hand once.
  for (const name of readdirSync(`${root}shared/${dir}`)) {
    copyFileSync(`${desktop}/${dir}/${name}`, `${root}shared/${dir}/${name}`);
    copied += 1;
  }
}
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: desktop }).toString().trim();
console.log(`copied ${copied} files from KaChat-Desktop ${commit}`);
