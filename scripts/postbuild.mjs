/**
 * postbuild.mjs — ينسخ ملفات FFmpeg Multi-Thread إلى dist/client بعد البناء
 * Developer: Marwan Negm
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distClient = path.join(root, "dist", "client");

const sources = [
  ["public/ffmpeg-core-esm.js", "ffmpeg-core-esm.js"],
  ["public/ffmpeg-core.js", "ffmpeg-core.js"],
  ["public/ffmpeg-core.wasm", "ffmpeg-core.wasm"],
  ["public/ffmpeg-core-mt.js", "ffmpeg-core-mt.js"],
  ["public/ffmpeg-core-mt.wasm", "ffmpeg-core-mt.wasm"],
  ["public/ffmpeg-core-mt.worker.js", "ffmpeg-core-mt.worker.js"],
];

console.log("\n📦 Copying FFmpeg WASM files to dist/client...");
let ok = 0,
  skip = 0;
for (const [src, dest] of sources) {
  const srcPath = path.join(root, src);
  const destPath = path.join(distClient, dest);
  if (!fs.existsSync(srcPath)) {
    console.warn("  ⚠️  Missing: " + src);
    skip++;
    continue;
  }
  fs.copyFileSync(srcPath, destPath);
  const size = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
  console.log("  ✅  " + dest + " (" + size + " MB)");
  ok++;
}
console.log("\n  Done: " + ok + " copied, " + skip + " skipped\n");
