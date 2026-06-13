/**
 * serve.mjs — Production server for Video/Audio Studio
 * Usage: node serve.mjs
 */

import http           from "http";
import fs             from "fs";
import path           from "path";
import { createGzip } from "zlib";

const PORT = parseInt(process.env.PORT ?? "5000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const ROOT = process.cwd();

// TanStack Start build output locations
const DIST_CLIENT = path.join(ROOT, "dist", "client");   // JS/CSS/HTML assets
const DIST_PUBLIC = path.join(ROOT, "dist", "public");   // copied static files
const PUBLIC_SRC  = path.join(ROOT, "public");           // source static files

const MIME = {
  ".html":  "text/html; charset=utf-8",
  ".js":    "text/javascript; charset=utf-8",
  ".mjs":   "text/javascript; charset=utf-8",
  ".css":   "text/css; charset=utf-8",
  ".wasm":  "application/wasm",
  ".json":  "application/json; charset=utf-8",
  ".svg":   "image/svg+xml",
  ".ico":   "image/x-icon",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".gif":   "image/gif",
  ".webp":  "image/webp",
  ".mp4":   "video/mp4",
  ".webm":  "video/webm",
  ".mp3":   "audio/mpeg",
  ".wav":   "audio/wav",
  ".txt":   "text/plain; charset=utf-8",
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

// Required for SharedArrayBuffer (FFmpeg multi-threading)
const COOP_COEP = {
  "Cross-Origin-Opener-Policy":   "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

function cacheControl(filePath) {
  const base = path.basename(filePath);
  if (base.endsWith(".wasm") || base.endsWith(".worker.js"))   return "public, max-age=31536000, immutable";
  if (/\.[0-9a-f]{8,}\.(js|css)$/.test(base))                 return "public, max-age=31536000, immutable";
  if (base.endsWith(".html"))                                   return "no-cache";
  return "public, max-age=86400";
}

async function maybeGzip(req, buf, contentType) {
  const ae = req.headers["accept-encoding"] ?? "";
  if (!ae.includes("gzip"))                                    return { buf, enc: null };
  if (contentType.startsWith("image/") || contentType === "application/wasm") return { buf, enc: null };
  if (buf.length < 1024)                                        return { buf, enc: null };
  return new Promise((res, rej) => {
    const gz = createGzip({ level: 6 }), chunks = [];
    gz.on("data", c => chunks.push(c));
    gz.on("end",  () => res({ buf: Buffer.concat(chunks), enc: "gzip" }));
    gz.on("error", rej);
    gz.end(buf);
  });
}

async function serveFile(req, res, filePath, extra = {}) {
  let buf;
  try { buf = fs.readFileSync(filePath); } catch { return false; }

  const ct = mimeFor(filePath);
  const { buf: body, enc } = await maybeGzip(req, buf, ct);
  const headers = {
    "Content-Type":  ct,
    "Cache-Control": cacheControl(filePath),
    ...COOP_COEP,
    ...extra,
  };
  if (enc) headers["Content-Encoding"] = enc;
  headers["Content-Length"] = String(body.length);
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

// Search order for a given pathname
function candidatePaths(pathname) {
  const rel = pathname.replace(/^\/+/, "");
  return [
    path.join(DIST_CLIENT, rel),   // dist/client/  ← main build output
    path.join(DIST_PUBLIC, rel),   // dist/public/  ← copied static assets
    path.join(PUBLIC_SRC,  rel),   // public/        ← source static assets
  ];
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  // 1. Try exact file match
  for (const fp of candidatePaths(pathname)) {
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      await serveFile(req, res, fp);
      return;
    }
  }

  // 2. Try index.html for SPA routes
  const indexCandidates = [
    path.join(DIST_CLIENT, pathname, "index.html"),
    path.join(DIST_CLIENT, "index.html"),
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
  console.log(`\n🚀  Video/Audio Studio → http://localhost:${PORT}`);
  console.log(`   ✅  COOP/COEP active → SharedArrayBuffer enabled`);
  console.log(`   🎬  FFmpeg multi-threading: ENABLED (4-8× faster)\n`);
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌  Port ${PORT} is already in use. Run: taskkill /F /IM node.exe`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
