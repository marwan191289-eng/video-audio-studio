/**
 * postbuild.mjs — Runs after `npm run build`
 * Ensures all FFmpeg WASM files are in dist/public/ for serving.
 */

import { existsSync, copyFileSync, mkdirSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const DIST_PUB   = path.join(ROOT, "dist", "public");
const PUBLIC_SRC = path.join(ROOT, "public");

if (!existsSync(DIST_PUB)) mkdirSync(DIST_PUB, { recursive: true });

const require = createRequire(import.meta.url);

const FILES = [
  // Single-thread ESM build
  { src: path.join(PUBLIC_SRC, "ffmpeg-core-esm.js"),          dst: "ffmpeg-core-esm.js" },
  { src: path.join(PUBLIC_SRC, "ffmpeg-core.js"),               dst: "ffmpeg-core.js" },
  { src: path.join(PUBLIC_SRC, "ffmpeg-core.wasm"),             dst: "ffmpeg-core.wasm" },
  // Multi-thread build
  { src: path.join(PUBLIC_SRC, "ffmpeg-core-mt.js"),            dst: "ffmpeg-core-mt.js" },
  { src: path.join(PUBLIC_SRC, "ffmpeg-core-mt.wasm"),          dst: "ffmpeg-core-mt.wasm" },
  { src: path.join(PUBLIC_SRC, "ffmpeg-core-mt.worker.js"),     dst: "ffmpeg-core-mt.worker.js" },
];

let copied = 0;
for (const { src, dst } of FILES) {
  const dstPath = path.join(DIST_PUB, dst);
  if (existsSync(src)) {
    try {
      copyFileSync(src, dstPath);
      console.log(`  ✅  dist/public/${dst}`);
      copied++;
    } catch (e) {
      console.warn(`  ⚠️  Failed to copy ${dst}: ${e.message}`);
    }
  } else {
    console.log(`  ⏭  skipped (not found): public/${dst}`);
  }
}
console.log(`\n📦  Post-build: ${copied}/${FILES.length} FFmpeg files copied to dist/public/`);
