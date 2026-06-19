import http from "node:http";
import { mkdir, writeFile, readFile, readdir, rm, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import Busboy from "busboy";

const execFileAsync = promisify(execFile);
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// ── FFmpeg binary ────────────────────────────────────────────────────────────
let ffmpegBin = "ffmpeg";
try {
  const { execFileSync } = await import("node:child_process");
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  console.log("[ffmpeg] using system ffmpeg");
} catch {
  try {
    const _req = createRequire(import.meta.url);
    const bin = _req("ffmpeg-static");
    if (bin && existsSync(bin)) { ffmpegBin = bin; console.log("[ffmpeg] using ffmpeg-static:", bin); }
  } catch { console.log("[ffmpeg] WARNING: no ffmpeg found"); }
}

// ── Build FFmpeg args (same logic as main app) ───────────────────────────────
function encodeArgs(crf = 20) {
  return ["-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-movflags", "+faststart", "-c:a", "copy"];
}

const COLOR_PRESETS = {
  vivid: "eq=contrast=1.2:saturation=1.5:brightness=0.05",
  cinema: "eq=contrast=1.15:saturation=0.85:gamma=1.1,curves=r='0/0 0.5/0.45 1/0.9':g='0/0 0.5/0.5 1/1':b='0/0.05 0.5/0.5 1/1'",
  warm: "eq=contrast=1.05:saturation=1.3",
  cool: "eq=contrast=1.05:saturation=1.1",
  vintage: "eq=contrast=0.9:saturation=0.7:brightness=0.05,curves=r='0/0.05 1/0.9':g='0/0.02 1/0.88':b='0/0.06 1/0.82'",
  bw: "hue=s=0,eq=contrast=1.1",
  dramatic: "eq=contrast=1.4:saturation=0.8:gamma=0.9",
  soft: "eq=contrast=0.95:saturation=1.1:brightness=0.03,unsharp=3:3:0.5",
  neon: "eq=contrast=1.3:saturation=2:brightness=-0.05",
};

function buildFFmpegArgs(mode, settings, inFile, outFile) {
  const base = ["-y", "-i", inFile];
  if (mode === "enhance") {
    const vf = [`eq=brightness=${settings.brightness??0}:contrast=${settings.contrast??1}:saturation=${settings.saturation??1}:gamma=${settings.gamma??1}`];
    if ((settings.sharpness ?? 0) > 0) vf.push(`unsharp=5:5:${Number(settings.sharpness).toFixed(2)}`);
    if (settings.denoiseFilter === "hqdn3d") vf.push("hqdn3d=4:3:6:4.5");
    else if (settings.denoiseFilter === "nlmeans") vf.push("hqdn3d=6:5:8:6");
    return [...base, "-vf", vf.join(","), ...encodeArgs(settings.crf), outFile];
  }
  if (mode === "auto-enhance") {
    const level = settings.autoLevel ?? "balanced";
    const vf = level === "light"
      ? ["hqdn3d=2:1:3:2.5", "eq=brightness=0.02:contrast=1.05:saturation=1.15:gamma=0.97", "unsharp=3:3:0.3"]
      : level === "strong"
      ? ["hqdn3d=4:3:6:4.5", "eq=brightness=0.05:contrast=1.15:saturation=1.4:gamma=0.92", "unsharp=5:5:0.8"]
      : ["hqdn3d=3:2:4:3.5", "eq=brightness=0.03:contrast=1.1:saturation=1.25:gamma=0.95", "unsharp=5:5:0.5"];
    return [...base, "-vf", vf.join(","), "-c:v", "libx264", "-preset", "fast", "-crf", level === "strong" ? "18" : level === "balanced" ? "20" : "22", "-movflags", "+faststart", "-c:a", "copy", outFile];
  }
  if (mode === "denoise") {
    const map = { light: "hqdn3d=2:1:3:2.5", medium: "hqdn3d=4:3:6:4.5", strong: "hqdn3d=6:5:10:7" };
    return [...base, "-vf", map[settings.denoiseStrength ?? "medium"], ...encodeArgs(), outFile];
  }
  if (mode === "compress") {
    return [...base, "-c:v", "libx264", "-preset", "medium", "-crf", String(settings.crf ?? 28), "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k", outFile];
  }
  if (mode === "upscale") {
    const [w, h] = (settings.upscaleRes ?? "1920x1080").split("x");
    return [...base, "-vf", `scale=${w}:${h}:flags=bilinear`, ...encodeArgs(), outFile];
  }
  if (mode === "trim") {
    const start = settings.trimStart ?? 0;
    const dur = Math.max(0.1, (settings.trimEnd ?? 10) - start);
    return ["-y", "-ss", String(start), "-i", inFile, "-t", String(dur), "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k", outFile];
  }
  if (mode === "speed") {
    const spd = settings.speed ?? 1;
    const atempo = Math.max(0.5, Math.min(2, spd));
    return [...base, "-filter_complex", `[0:v]setpts=${(1/spd).toFixed(4)}*PTS[v];[0:a]atempo=${atempo}[a]`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k", outFile];
  }
  if (mode === "rotate") {
    const f = { "90cw": "transpose=1", "90ccw": "transpose=2", "180": "transpose=2,transpose=2", fliph: "hflip", flipv: "vflip" }[settings.rotateDir ?? "90cw"] ?? "transpose=1";
    return [...base, "-vf", f, ...encodeArgs(), outFile];
  }
  if (mode === "crop") return [...base, "-vf", "crop=iw*0.8:ih*0.8:iw*0.1:ih*0.1", ...encodeArgs(), outFile];
  if (mode === "fps") return [...base, "-filter:v", `fps=${settings.targetFps ?? 30}`, ...encodeArgs(), outFile];
  if (mode === "extract-audio") return ["-y", "-i", inFile, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outFile];
  if (mode === "remove-audio") return [...base, "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-movflags", "+faststart", "-an", outFile];
  if (mode === "gif") {
    const fps = settings.gifFps ?? 10; const w = settings.gifWidth ?? 480;
    return [...base, "-vf", `fps=${fps},scale=${w}:-1:flags=bilinear,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`, outFile];
  }
  if (mode === "thumbnail") return ["-y", "-ss", String(settings.thumbAt ?? 2), "-i", inFile, "-frames:v", "1", "-q:v", "2", outFile];
  if (mode === "color-grade") {
    const preset = settings.colorPreset && COLOR_PRESETS[settings.colorPreset];
    const custom = `eq=brightness=${settings.brightness2??0}:contrast=${settings.contrast2??1}:saturation=${settings.saturation2??1}:gamma=${settings.gamma2??1}`;
    return [...base, "-vf", preset ?? custom, ...encodeArgs(), outFile];
  }
  if (mode === "stabilize") return [...base, "-vf", "vidstabtransform=smoothing=20,unsharp=3:3:0.5", ...encodeArgs(), outFile];
  return [...base, "-vf", "hqdn3d=3:2:4:3.5,eq=brightness=0.03:contrast=1.1:saturation=1.25:gamma=0.95,unsharp=5:5:0.5", ...encodeArgs(), outFile];
}

function outputExtForMode(mode) {
  if (mode === "extract-audio") return "mp3";
  if (mode === "gif") return "gif";
  if (mode === "thumbnail") return "jpg";
  return "mp4";
}

function mimeForExt(ext) {
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "video/mp4";
}

// ── CORS headers ─────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── Parse raw body ────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on("data", d => parts.push(d));
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

// ── Parse multipart with busboy ───────────────────────────────────────────────
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 500 * 1024 * 1024 } });
    const fields = {};
    let fileBuffer = null;
    bb.on("file", (_field, file) => {
      const chunks = [];
      file.on("data", d => chunks.push(d));
      file.on("end", () => { fileBuffer = Buffer.concat(chunks); });
    });
    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("finish", () => resolve({ fields, fileBuffer }));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split("?")[0];

  // ── Health check ─────────────────────────────────────────────────────────
  if (url === "/" || url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ffmpeg: ffmpegBin }));
    return;
  }

  // ── POST /upload-chunk ────────────────────────────────────────────────────
  if (url === "/upload-chunk" && req.method === "POST") {
    try {
      const { fields, fileBuffer } = await parseMultipart(req);
      const { sessionId, chunkIndex } = fields;
      if (!sessionId || chunkIndex === undefined || !fileBuffer) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing sessionId, chunkIndex or chunk data" }));
        return;
      }
      const sessionDir = join(tmpdir(), "ffapi-sessions", sessionId);
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(sessionDir, `chunk_${String(chunkIndex).padStart(5, "0")}`), fileBuffer);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, received: Number(chunkIndex) }));
    } catch (err) {
      console.error("[/upload-chunk]", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /enhance ─────────────────────────────────────────────────────────
  if (url === "/enhance" && req.method === "POST") {
    const ts = Date.now();
    const tmpIn  = join(tmpdir(), `ffapi-in-${ts}.mp4`);
    const tmpOut = join(tmpdir(), `ffapi-out-${ts}`);
    let sessionDir = null;

    try {
      const { fields, fileBuffer } = await parseMultipart(req);
      const mode        = fields.mode || "enhance";
      const sessionId   = fields.sessionId || null;
      const totalChunks = parseInt(fields.totalChunks || "0", 10);
      let settings = {};
      try { settings = JSON.parse(fields.settings || "{}"); } catch {}

      if (sessionId && totalChunks > 0) {
        sessionDir = join(tmpdir(), "ffapi-sessions", sessionId);
        const files = await readdir(sessionDir);
        const chunkFiles = files.filter(f => f.startsWith("chunk_")).sort();
        if (chunkFiles.length !== totalChunks) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `expected ${totalChunks} chunks, got ${chunkFiles.length}` }));
          return;
        }
        const parts = [];
        for (const cf of chunkFiles) parts.push(await readFile(join(sessionDir, cf)));
        await writeFile(tmpIn, Buffer.concat(parts));
        console.log(`[/enhance] assembled ${chunkFiles.length} chunks (${(Buffer.concat(parts).length/1024/1024).toFixed(1)} MB)`);
      } else if (fileBuffer) {
        await writeFile(tmpIn, fileBuffer);
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no file or session provided" }));
        return;
      }

      const ext    = outputExtForMode(mode);
      const outFile = `${tmpOut}.${ext}`;
      const args   = buildFFmpegArgs(mode, settings, tmpIn, outFile);
      console.log(`[/enhance] mode=${mode} ffmpeg ${args.slice(3).join(" ")}`);

      await execFileAsync(ffmpegBin, args, { maxBuffer: 500 * 1024 * 1024, timeout: 20 * 60 * 1000 });

      const outBuf = await readFile(outFile);
      const mime   = mimeForExt(ext);

      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": String(outBuf.length),
        "Content-Disposition": `attachment; filename="enhanced.${ext}"`,
        "Access-Control-Allow-Origin": CORS_ORIGIN,
      });
      res.end(outBuf);
      console.log(`[/enhance] done — sent ${(outBuf.length/1024/1024).toFixed(1)} MB`);
    } catch (err) {
      console.error("[/enhance] error:", err.message?.slice(0, 500));
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "ffmpeg processing failed", detail: err.message?.slice(0, 400) }));
      }
    } finally {
      unlink(tmpIn).catch(() => {});
      unlink(`${tmpOut}.${outputExtForMode((new URLSearchParams()).get("mode") || "mp4")}`).catch(() => {});
      if (sessionDir) rm(sessionDir, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.timeout = 25 * 60 * 1000;
server.keepAliveTimeout = 25 * 60 * 1000;

server.listen(PORT, () => {
  console.log(`✅ FFmpeg API running on port ${PORT}`);
  console.log(`   ffmpeg binary: ${ffmpegBin}`);
});
