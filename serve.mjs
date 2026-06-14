/**
 * serve.mjs — Production server for Video Audio Studio
 * Developer: Marwan Negm
 * 
 * يخدم التطبيق المبني من dist/ مع الإعدادات الصحيحة لـ FFmpeg.wasm:
 * - COOP/COEP headers (مطلوبة لـ SharedArrayBuffer / Multi-Thread)
 * - MIME types صحيحة لملفات WASM
 * - Cache طويل لملفات WASM الكبيرة
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, "dist", "client");

// ── COOP/COEP — مطلوب لـ SharedArrayBuffer (Multi-Thread FFmpeg) ──────────
const SECURITY_HEADERS = {
  "Cross-Origin-Opener-Policy":   "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".ico":  "image/x-icon",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".mp4":  "video/mp4",
  ".webm": "video/webm",
  ".mp3":  "audio/mpeg",
  ".wav":  "audio/wav",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
  ".ttf":  "font/ttf",
};

function getCacheControl(ext) {
  if ([".wasm", ".woff2", ".woff", ".ttf"].includes(ext))
    return "public, max-age=31536000, immutable";
  if (ext === ".html") return "no-cache";
  return "public, max-age=86400";
}

// ── Load SSR handler ───────────────────────────────────────────────────────
let ssrHandler = null;
async function getSSRHandler() {
  if (ssrHandler) return ssrHandler;
  try {
    const mod = await import(path.join(__dirname, "dist", "server", "server.js"));
    ssrHandler = mod.default;
    return ssrHandler;
  } catch (e) {
    console.error("SSR load failed:", e.message);
    return null;
  }
}

// ── Node → Web Request ─────────────────────────────────────────────────────
async function nodeToWebRequest(req) {
  const proto = req.socket?.encrypted ? "https" : "http";
  const host = req.headers.host || `localhost:${PORT}`;
  const url = new URL(req.url, `${proto}://${host}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : null;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  return new Request(url.toString(), {
    method: req.method, headers,
    body: body?.length ? body : undefined,
    duplex: "half",
  });
}

// ── Web Response → Node ────────────────────────────────────────────────────
async function webToNodeResponse(webRes, res) {
  const headers = {};
  webRes.headers.forEach((v, k) => { headers[k] = v; });
  Object.assign(headers, SECURITY_HEADERS);
  res.writeHead(webRes.status ?? 200, headers);
  if (webRes.body) {
    const reader = webRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}

// ── Static file ────────────────────────────────────────────────────────────
function serveStatic(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": getCacheControl(ext),
      ...SECURITY_HEADERS,
    });
    res.end(data);
  });
}

// ── Main handler ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = new URL(req.url, "http://x").pathname;
    const staticPath = path.join(CLIENT_DIR, urlPath);

    if (urlPath !== "/" && !urlPath.startsWith("/api/") &&
        fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      return serveStatic(staticPath, res);
    }

    const handler = await getSSRHandler();
    if (!handler) {
      const idx = path.join(CLIENT_DIR, "index.html");
      if (fs.existsSync(idx)) return serveStatic(idx, res);
      res.writeHead(503); res.end("Building..."); return;
    }

    const webReq = await nodeToWebRequest(req);
    const webRes = await handler.fetch(webReq, {}, {});
    await webToNodeResponse(webRes, res);
  } catch (err) {
    console.error(err);
    res.writeHead(500); res.end("Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  ✅  Video Audio Studio");
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log("  👨‍💻  Developer: Marwan Negm");
  console.log("");
  console.log("  اضغط Ctrl+C للإيقاف");
  console.log("");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  ❌  المنفذ ${PORT} مستخدم — جرب: PORT=3001 node serve.mjs`);
  } else console.error(err);
  process.exit(1);
});

process.on("SIGTERM", () => { server.close(); process.exit(0); });
process.on("SIGINT",  () => { server.close(); process.exit(0); });
