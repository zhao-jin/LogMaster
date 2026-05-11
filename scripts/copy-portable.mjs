// Copy the built Tauri release exe into ./dist-bundle as a portable artifact.
// Runs after `tauri build` so users get a single drop-in LogMaster.exe.
import { mkdirSync, copyFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, "src-tauri/target/release/logmaster.exe");
const outDir = resolve(root, "dist-bundle");
const dst = resolve(outDir, "LogMaster.exe");

if (!existsSync(src)) {
  console.error(`[portable] missing release exe: ${src}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
copyFileSync(src, dst);
const sizeMB = (statSync(dst).size / 1024 / 1024).toFixed(2);
console.log(`[portable] -> ${dst}  (${sizeMB} MB)`);
