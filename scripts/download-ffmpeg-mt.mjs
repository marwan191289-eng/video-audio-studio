/**
 * download-ffmpeg-mt.mjs — Fixed version
 * Copies MT FFmpeg files from @ffmpeg/core-mt to public/
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

if (!existsSync(PUBLIC)) mkdirSync(PUBLIC, { recursive: true });

// Find @ffmpeg/core-mt in node_modules
const MT_ROOT = path.join(ROOT, "node_modules", "@ffmpeg", "core-mt");

if (!existsSync(MT_ROOT)) {
  console.log("⚠️  @ffmpeg/core-mt not found — skipping MT copy.");
  process.exit(0);
}

// Auto-detect the dist directory (could be dist/esm, dist/umd, dist/, etc.)
function findFiles(dir, names) {
  const results = {};
  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      for (const n of names) {
        if (e.name === n && !results[n]) results[n] = full;
      }
    }
  }
  walk(dir);
  return results;
}

const found = findFiles(MT_ROOT, ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"]);

console.log("Found MT files:", found);

const MAP = [
  { key: "ffmpeg-core.js", dst: "ffmpeg-core-mt.js" },
  { key: "ffmpeg-core.wasm", dst: "ffmpeg-core-mt.wasm" },
  { key: "ffmpeg-core.worker.js", dst: "ffmpeg-core-mt.worker.js" },
];

let ok = 0;
for (const { key, dst } of MAP) {
  const src = found[key];
  const dstPath = path.join(PUBLIC, dst);
  if (src && existsSync(src)) {
    try {
      copyFileSync(src, dstPath);
      console.log(`  ✅  public/${dst}`);
      ok++;
    } catch (e) {
      console.warn(`  ⚠️  Failed: ${e.message}`);
    }
  } else {
    console.warn(`  ⚠️  Not found: ${key}`);
  }
}

console.log(
  ok === MAP.length
    ? "\n🚀  FFmpeg MT ready — parallel encoding ENABLED"
    : `\n⚠️  ${ok}/${MAP.length} MT files copied — partial MT support`,
);
