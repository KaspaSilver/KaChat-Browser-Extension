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
// Only the files already here: the extension uses a subset of each folder. A new engine import
// needs its file copied in by hand once. Subfolders (engine/kachat-names) are walked too.
function sync(dir) {
  for (const entry of readdirSync(`${root}shared/${dir}`, { withFileTypes: true })) {
    if (entry.name === "README.md") continue;
    if (entry.isDirectory()) { sync(`${dir}/${entry.name}`); continue; }
    copyFileSync(`${desktop}/${dir}/${entry.name}`, `${root}shared/${dir}/${entry.name}`);
    copied += 1;
  }
}
for (const dir of ["engine", "ui", "kaspa"]) sync(dir);
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: desktop }).toString().trim();
console.log(`copied ${copied} files from KaChat-Desktop ${commit}`);
