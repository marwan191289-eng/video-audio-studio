/**
 * download-ffmpeg-mt.mjs
 * Copies multi-threaded FFmpeg WASM files from @ffmpeg/core-mt (node_modules)
 * into public/ so the browser can load the faster parallel build.
 *
 * Run automatically via: npm run build  (prebuild hook)
 */

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { createRequire }                        from "module";
import path                                     from "path";
import { fileURLToPath }                        from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const PUBLIC    = path.join(ROOT, "public");

if (!existsSync(PUBLIC)) mkdirSync(PUBLIC, { recursive: true });

const require = createRequire(import.meta.url);

let hasMT = true;
try { require.resolve("@ffmpeg/core-mt"); } catch { hasMT = false; }

if (!hasMT) {
  console.log("⚠️  @ffmpeg/core-mt not installed — skipping MT copy (single-thread fallback).");
  process.exit(0);
}

const FILES = [
  { src: require.resolve("@ffmpeg/core-mt/dist/esm/ffmpeg-core.js"),        dst: "ffmpeg-core-mt.js"        },
  { src: require.resolve("@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm"),      dst: "ffmpeg-core-mt.wasm"      },
  { src: require.resolve("@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js"), dst: "ffmpeg-core-mt.worker.js" },
];

let ok = 0;
for (const { src, dst } of FILES) {
  const dstPath = path.join(PUBLIC, dst);
  try {
    copyFileSync(src, dstPath);
    console.log(`  ✅  public/${dst}`);
    ok++;
  } catch (e) {
    console.warn(`  ⚠️  could not copy ${dst}: ${e.message}`);
  }
}

console.log(ok === FILES.length
  ? "\n🚀  FFmpeg MT ready — parallel encoding ENABLED (4-8× faster)"
  : "\n⚠️  Some MT files missing — falling back to single-thread");
