/**
 * serve.mjs — Production server for Video Audio Studio
 */

import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawn, execFileSync } from "child_process";
import Busboy from "busboy";
import { createRequire } from "module";
import { mkdir, writeFile, readFile, unlink, readdir, rm } from "fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5000;
const CLIENT_DIR = path.join(__dirname, "dist", "client");

// ── ffmpeg-static ─────────────────────────────────────────────────────────
const _require = createRequire(import.meta.url);

let FFMPEG_BIN = "ffmpeg";
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  FFMPEG_BIN = "ffmpeg";
} catch {
  try {
    const bin = _require("ffmpeg-static");
    if (bin && fs.existsSync(bin)) FFMPEG_BIN = bin;
  } catch { /* ignore */ }
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    FFMPEG_BIN = process.env.FFMPEG_PATH;
  }
}
console.log("  🎬  FFmpeg binary:", FFMPEG_BIN);

// ── Async Job Queue ───────────────────────────────────────────────────────
const _jobs = new Map();
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of _jobs) {
    if (job.createdAt < cutoff) {
      if (job.outputPath) unlink(job.outputPath).catch(() => {});
      _jobs.delete(id);
    }
  }
}, 15 * 60 * 1000);

async function getBuildFFmpegArgs() {
  return import(pathToFileURL(path.join(__dirname, "dist", "server", "build-ffmpeg-args.js")).href)
    .catch(() => import("./server/build-ffmpeg-args.ts"));
}

async function runEnhanceJob(jobId, mode, settings, inputBuffer, sessionId, totalChunks, ext) {
  const ts = Date.now();
  const tmpIn = path.join(os.tmpdir(), `job-in-${ts}.mp4`);
  const tmpOut = path.join(os.tmpdir(), `job-out-${ts}.${ext}`);
  let sessionDir = null;

  try {
    if (sessionId && totalChunks > 0) {
      sessionDir = path.join(os.tmpdir(), "vep-sessions", sessionId);
      const files = await readdir(sessionDir);
      const chunkFiles = files.filter((f) => f.startsWith("chunk_")).sort();
      if (chunkFiles.length !== totalChunks) {
        throw new Error(`Expected ${totalChunks} chunks, received ${chunkFiles.length}`);
      }
      const parts = [];
      for (const cf of chunkFiles) parts.push(await readFile(path.join(sessionDir, cf)));
      await writeFile(tmpIn, Buffer.concat(parts));
      console.log(`[job:${jobId}] assembled ${chunkFiles.length} chunks → ${tmpIn}`);
    } else if (inputBuffer) {
      await writeFile(tmpIn, inputBuffer);
    } else {
      throw new Error("No data to process");
    }

    const { buildFFmpegArgs } = await getBuildFFmpegArgs();
    const args = buildFFmpegArgs(mode, settings, tmpIn, tmpOut);
    console.log(`[job:${jobId}] mode=${mode} ffmpeg ${args.slice(0, 6).join(" ")} ...`);

    await new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d; });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-500)}`));
      });
    });

    const job = _jobs.get(jobId);
    if (job) { job.status = "done"; job.outputPath = tmpOut; }
    console.log(`[job:${jobId}] ✅ done`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[job:${jobId}] ❌ failed: ${msg.slice(0, 400)}`);
    const job = _jobs.get(jobId);
    if (job) { job.status = "failed"; job.error = msg.slice(0, 400); }
    unlink(tmpIn).catch(() => {});
    unlink(tmpOut).catch(() => {});
  } finally {
    unlink(tmpIn).catch(() => {});
    if (sessionDir) rm(sessionDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── COOP/COEP headers ─────────────────────────────────────────────────────
const SECURITY_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function getCacheControl(ext) {
  if ([".wasm", ".woff2", ".woff", ".ttf"].includes(ext)) return "public, max-age=31536000, immutable";
  if (ext === ".html") return "no-cache";
  return "public, max-age=86400";
}

// ── SSR handler ───────────────────────────────────────────────────────────
let ssrHandler = null;
async function getSSRHandler() {
  if (ssrHandler) return ssrHandler;
  try {
    const mod = await import(pathToFileURL(path.join(__dirname, "dist", "server", "server.js")).href);
    ssrHandler = mod.default;
    return ssrHandler;
  } catch (e) {
    console.error("SSR load failed:", e.message);
    return null;
  }
}

// ── Static file ───────────────────────────────────────────────────────────
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

// ── Busboy helper: parse multipart ────────────────────────────────────────
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const fields = {};
    let fileBuffer = null;

    bb.on("file", (_field, file) => {
      const parts = [];
      file.on("data", (d) => parts.push(d));
      file.on("end", () => { fileBuffer = Buffer.concat(parts); });
    });

    bb.on("field", (name, value) => { fields[name] = value; });
    bb.on("finish", () => resolve({ fields, fileBuffer }));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

// ── Node → Web Request (for SSR, small bodies only) ──────────────────────
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
    method: req.method,
    headers,
    body: body?.length ? body : undefined,
    duplex: "half",
  });
}

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

// ── Main handler ──────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = new URL(req.url, "http://x").pathname;

    // ── POST /api/upload-chunk ──────────────────────────────────────────
    if (urlPath === "/api/upload-chunk" && req.method === "POST") {
      try {
        const { fields, fileBuffer } = await parseMultipart(req);
        const sessionId = fields.sessionId;
        const chunkIndex = parseInt(fields.chunkIndex ?? "0", 10);

        if (!sessionId || !fileBuffer) {
          res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
          res.end(JSON.stringify({ error: "Missing sessionId or chunk data" }));
          return;
        }

        const sessionDir = path.join(os.tmpdir(), "vep-sessions", sessionId);
        await mkdir(sessionDir, { recursive: true });
        const chunkFile = path.join(sessionDir, `chunk_${String(chunkIndex).padStart(5, "0")}`);
        await writeFile(chunkFile, fileBuffer);

        res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(JSON.stringify({ ok: true, received: chunkIndex }));
      } catch (err) {
        console.error("[/api/upload-chunk]", err);
        res.writeHead(500, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: "Chunk upload failed" }));
      }
      return;
    }

    // ── POST /api/enhance-async ─────────────────────────────────────────
    if (urlPath === "/api/enhance-async" && req.method === "POST") {
      try {
        const { fields, fileBuffer } = await parseMultipart(req);
        const mode = fields.mode || "enhance";
        const sessionId = fields.sessionId || null;
        const totalChunks = parseInt(fields.totalChunks ?? "0", 10);
        let settings = {};
        if (fields.settings) {
          try { settings = JSON.parse(fields.settings); } catch { /* ignore */ }
        }

        const { outputExtForMode } = await getBuildFFmpegArgs();
        const ext = typeof outputExtForMode === "function"
          ? outputExtForMode(mode)
          : (mode === "extract-audio" ? "mp3" : mode === "gif" ? "gif" : mode === "thumbnail" ? "jpg" : "mp4");

        const jobId = crypto.randomUUID();
        _jobs.set(jobId, { status: "processing", ext, createdAt: Date.now() });

        runEnhanceJob(jobId, mode, settings, fileBuffer, sessionId, totalChunks, ext)
          .catch((err) => console.error("[enhance-async] unexpected:", err));

        res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(JSON.stringify({ jobId }));
      } catch (err) {
        console.error("[/api/enhance-async]", err);
        res.writeHead(500, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // ── GET /api/job/:id ────────────────────────────────────────────────
    if (urlPath.startsWith("/api/job/") && !urlPath.includes("/result") && req.method === "GET") {
      const jobId = urlPath.slice("/api/job/".length);
      const job = _jobs.get(jobId);
      if (!job) {
        res.writeHead(404, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: "Job not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", ...SECURITY_HEADERS });
        res.end(JSON.stringify({ status: job.status, error: job.error }));
      }
      return;
    }

    // ── GET /api/job-result/:id ─────────────────────────────────────────
    if (urlPath.startsWith("/api/job-result/") && req.method === "GET") {
      const jobId = urlPath.slice("/api/job-result/".length);
      const job = _jobs.get(jobId);
      if (!job || job.status !== "done" || !job.outputPath) {
        res.writeHead(404, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: "Result not ready" }));
        return;
      }
      try {
        const buf = await readFile(job.outputPath);
        const ext = job.ext;
        const mime =
          ext === "mp3" ? "audio/mpeg"
          : ext === "gif" ? "image/gif"
          : ext === "jpg" ? "image/jpeg"
          : ext === "wav" ? "audio/wav"
          : ext === "webm" ? "video/webm"
          : "video/mp4";
        const outputPath = job.outputPath;
        setTimeout(() => { unlink(outputPath).catch(() => {}); _jobs.delete(jobId); }, 30_000);
        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": String(buf.length),
          "Content-Disposition": `attachment; filename="enhanced.${ext}"`,
          ...SECURITY_HEADERS,
        });
        res.end(buf);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: "Failed to read result" }));
      }
      return;
    }

    // ── GET /api/videos/:name ───────────────────────────────────────────
    if (urlPath.startsWith("/api/videos/") && req.method === "GET") {
      const fileName = decodeURIComponent(urlPath.slice("/api/videos/".length));
      if (fileName && !fileName.includes("..")) {
        const filePath = path.join(__dirname, "uploads", fileName);
        if (fs.existsSync(filePath)) {
          const buf = fs.readFileSync(filePath);
          const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
          const mime = MIME[`.${ext}`] || "application/octet-stream";
          res.writeHead(200, {
            "Content-Type": mime,
            "Content-Disposition": `attachment; filename="${fileName.replace(/^[^-]+-/, "")}"`,
            ...SECURITY_HEADERS,
          });
          res.end(buf);
          return;
        }
        res.writeHead(404); res.end("Not found"); return;
      }
    }

    // ── Static files ────────────────────────────────────────────────────
    const staticPath = path.join(CLIENT_DIR, urlPath);
    if (
      urlPath !== "/" &&
      !urlPath.startsWith("/api/") &&
      fs.existsSync(staticPath) &&
      fs.statSync(staticPath).isFile()
    ) {
      return serveStatic(staticPath, res);
    }

    // ── SSR handler ─────────────────────────────────────────────────────
    const handler = await getSSRHandler();
    if (!handler) {
      const idx = path.join(CLIENT_DIR, "index.html");
      if (fs.existsSync(idx)) return serveStatic(idx, res);
      res.writeHead(503); res.end("Building...");
      return;
    }

    const webReq = await nodeToWebRequest(req);
    const webRes = await handler.fetch(webReq, {}, {});
    await webToNodeResponse(webRes, res);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end("Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  ✅  Video Audio Studio");
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log("");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  ❌  Port ${PORT} in use`);
  } else console.error(err);
  process.exit(1);
});

process.on("SIGTERM", () => { server.close(); process.exit(0); });
process.on("SIGINT", () => { server.close(); process.exit(0); });
