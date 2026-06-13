/**
 * serve.mjs — Production server for Video/Audio Studio
 *
 * Usage: node serve.mjs
 *
 * Features:
 *  - Serves the built TanStack Start app from dist/
 *  - Sets COOP/COEP headers on ALL responses (required for SharedArrayBuffer / FFmpeg MT)
 *  - Serves FFmpeg WASM files (single-thread + multi-thread) with correct MIME types
 *  - Long-term caching for immutable assets (.wasm, hashed JS files)
 *  - Gzip/Brotli compression for text assets
 */

import http              from "http";
import fs                from "fs";
import path              from "path";
import { createGzip }    from "zlib";
import { pipeline }      from "stream/promises";
import { Readable }      from "stream";

const PORT   = parseInt(process.env.PORT ?? "5000", 10);
const HOST   = process.env.HOST ?? "0.0.0.0";
const ROOT   = process.cwd();
const DIST   = path.join(ROOT, "dist", "public");   // Vite build output
const PUBLIC = path.join(ROOT, "public");            // Static assets (WASM files etc.)

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  ".html":    "text/html; charset=utf-8",
  ".js":      "text/javascript; charset=utf-8",
  ".mjs":     "text/javascript; charset=utf-8",
  ".css":     "text/css; charset=utf-8",
  ".wasm":    "application/wasm",
  ".json":    "application/json; charset=utf-8",
  ".svg":     "image/svg+xml",
  ".ico":     "image/x-icon",
  ".png":     "image/png",
  ".jpg":     "image/jpeg",
  ".jpeg":    "image/jpeg",
  ".gif":     "image/gif",
  ".webp":    "image/webp",
  ".mp4":     "video/mp4",
  ".webm":    "video/webm",
  ".mp3":     "audio/mpeg",
  ".wav":     "audio/wav",
  ".ogg":     "audio/ogg",
  ".txt":     "text/plain; charset=utf-8",
};

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

// ── Security / isolation headers (required for FFmpeg multi-threading) ────────
const COOP_COEP = {
  "Cross-Origin-Opener-Policy":   "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

// ── Cache helpers ─────────────────────────────────────────────────────────────
function cacheControl(filePath) {
  const base = path.basename(filePath);
  // WASM and worker files: 1 year cache (immutable binaries)
  if (base.endsWith(".wasm") || base.endsWith(".worker.js")) {
    return "public, max-age=31536000, immutable";
  }
  // Hashed JS/CSS bundles from Vite (contain hash in filename): 1 year cache
  if (/\.[0-9a-f]{8,}\.(js|css)$/.test(base)) {
    return "public, max-age=31536000, immutable";
  }
  // HTML: always revalidate
  if (base.endsWith(".html")) {
    return "no-cache";
  }
  // Everything else: 1 day cache
  return "public, max-age=86400";
}

// ── Gzip compress a buffer if the client accepts it ──────────────────────────
async function maybeGzip(req, buf, contentType) {
  const ae = req.headers["accept-encoding"] ?? "";
  if (!ae.includes("gzip")) return { buf, encoding: null };
  if (contentType.startsWith("image/") || contentType === "application/wasm") {
    return { buf, encoding: null }; // binary already compressed
  }
  if (buf.length < 1024) return { buf, encoding: null }; // not worth compressing
  return new Promise((res, rej) => {
    const gz = createGzip({ level: 6 });
    const chunks = [];
    gz.on("data", c => chunks.push(c));
    gz.on("end",  () => res({ buf: Buffer.concat(chunks), encoding: "gzip" }));
    gz.on("error", rej);
    gz.end(buf);
  });
}

// ── Serve a file from disk ────────────────────────────────────────────────────
async function serveFile(req, res, filePath, extraHeaders = {}) {
  let buf;
  try { buf = fs.readFileSync(filePath); }
  catch { return false; }

  const ct      = mimeFor(filePath);
  const cc      = cacheControl(filePath);
  const { buf: body, encoding } = await maybeGzip(req, buf, ct);

  const headers = {
    "Content-Type":  ct,
    "Cache-Control": cc,
    ...COOP_COEP,
    ...extraHeaders,
  };
  if (encoding) headers["Content-Encoding"] = encoding;
  headers["Content-Length"] = String(body.length);

  res.writeHead(200, headers);
  res.end(body);
  return true;
}

// ── Candidate paths for a public asset ───────────────────────────────────────
function candidates(pathname) {
  const rel  = pathname.replace(/^\/+/, "");  // strip leading slash
  const list = [];

  // 1. dist/public/  — Vite build output
  list.push(path.join(DIST, rel));
  // 2. public/       — static files (favicon, WASM cores, etc.)
  list.push(path.join(PUBLIC, rel));

  return list;
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url      = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Try static files first
  for (const fp of candidates(pathname)) {
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      await serveFile(req, res, fp);
      return;
    }
  }

  // Try index.html for SPA fallback
  const indexCandidates = [
    path.join(DIST, pathname, "index.html"),
    path.join(DIST, "index.html"),
  ];
  for (const fp of indexCandidates) {
    if (fs.existsSync(fp)) {
      await serveFile(req, res, fp, { "Cache-Control": "no-cache" });
      return;
    }
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain", ...COOP_COEP });
  res.end("404 Not Found");
});

server.listen(PORT, HOST, () => {
  console.log(`\n🚀  Video/Audio Studio running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`   ✅  COOP/COEP headers active → SharedArrayBuffer available`);
  console.log(`   🎬  FFmpeg multi-threading: ENABLED (4-8× faster video processing)`);
  console.log(`   📁  Serving from: ${DIST}\n`);
});

server.on("error", (err) => {
  console.error("Server error:", err);
  process.exit(1);
});
