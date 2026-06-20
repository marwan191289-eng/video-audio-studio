import "./lib/error-capture";
import { readFileSync, existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const COOP_COEP = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

function withCrossOriginHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(COOP_COEP)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ── FFmpeg file cache ──────────────────────────────────────────────────────

type FFmpegFileKey =
  | "core-esm-js"
  | "core-umd-js"
  | "core-wasm"
  | "core-mt-js"
  | "core-mt-wasm"
  | "core-mt-worker";

const _cache = new Map<FFmpegFileKey, ArrayBuffer>();

function ffmpegBuf(key: FFmpegFileKey, ...candidates: string[]): ArrayBuffer | null {
  if (_cache.has(key)) return _cache.get(key)!;
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const buf = readFileSync(p);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        _cache.set(key, ab);
        return ab;
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

const R = (...parts: string[]) => join(process.cwd(), ...parts);

// ── Async Job Queue ──────────────────────────────────────────────────────────

interface EnhanceJob {
  status: "processing" | "done" | "failed" | "cancelled";
  outputPath?: string;
  ext: string;
  error?: string;
  createdAt: number;
  progress?: number;
  ffmpegProcess?: { kill(signal?: string): boolean };
}

const _jobs = new Map<string, EnhanceJob>();

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of _jobs) {
    if (job.createdAt < cutoff) {
      if (job.outputPath) {
        import("fs/promises").then(({ unlink }) => unlink(job.outputPath!).catch(() => {}));
      }
      _jobs.delete(id);
    }
  }
}, 15 * 60 * 1000);

async function runEnhanceJob(
  jobId: string,
  mode: string,
  settings: Record<string, unknown>,
  inputBuffer: Buffer | null,
  sessionId: string | null,
  totalChunks: number,
  ext: string,
): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const { writeFile: wf, readFile: rf, unlink: ul, readdir, rm } = await import("fs/promises");
  const { existsSync: ex } = await import("fs");
  const { tmpdir } = await import("os");
  const { join: pj } = await import("path");
  const { createRequire } = await import("module");
  const execFileAsync = promisify(execFile);

  let ffmpegBin = "ffmpeg";
  try {
    const { execFileSync } = await import("child_process");
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    const _req = createRequire(import.meta.url);
    try {
      const bin: string = _req("ffmpeg-static");
      if (bin && ex(bin)) ffmpegBin = bin;
    } catch { /* keep "ffmpeg" */ }
    if (process.env.FFMPEG_PATH && ex(process.env.FFMPEG_PATH)) {
      ffmpegBin = process.env.FFMPEG_PATH;
    }
  }

  const { buildFFmpegArgs } = await import("../server/build-ffmpeg-args.js")
    .catch(() => import("../server/build-ffmpeg-args.ts"));

  const ts = Date.now();
  const tmpIn = pj(tmpdir(), `job-in-${ts}.mp4`);
  const tmpOut = pj(tmpdir(), `job-out-${ts}.${ext}`);
  let sessionDir: string | null = null;

  try {
    if (sessionId && totalChunks > 0) {
      sessionDir = pj(tmpdir(), "vep-sessions", sessionId);
      const files = await readdir(sessionDir);
      const chunkFiles = files.filter((f) => f.startsWith("chunk_")).sort();
      if (chunkFiles.length !== totalChunks) {
        throw new Error(`الأجزاء المطلوبة ${totalChunks} لكن تم استلام ${chunkFiles.length}`);
      }
      const parts: Buffer[] = [];
      for (const cf of chunkFiles) parts.push(await rf(pj(sessionDir, cf)));
      await wf(tmpIn, Buffer.concat(parts));
      console.log(`[job:${jobId}] assembled ${chunkFiles.length} chunks → ${tmpIn}`);
    } else if (inputBuffer) {
      await wf(tmpIn, inputBuffer);
    } else {
      throw new Error("لا توجد بيانات للمعالجة");
    }

    const args = buildFFmpegArgs(mode, settings as Parameters<typeof buildFFmpegArgs>[1], tmpIn, tmpOut);
    console.log(`[job:${jobId}] mode=${mode} ffmpeg ${args.slice(0, 6).join(" ")} ...`);

    // ── Real-time progress tracking ──────────────────────────────────────
    let totalDurationSec = 0;
    const ffprobeBin = ffmpegBin === "ffmpeg" ? "ffprobe" : ffmpegBin.replace(/ffmpeg$/, "ffprobe");
    try {
      const { stdout: probeOut } = await execFileAsync(ffprobeBin, [
        "-v", "quiet", "-print_format", "json", "-show_format", tmpIn,
      ], { timeout: 10_000 } as object);
      const probe = JSON.parse(probeOut) as { format?: { duration?: string } };
      totalDurationSec = parseFloat(probe.format?.duration ?? "0");
    } catch { /* no duration — progress will be indeterminate */ }

    const progressFile = `${tmpOut}.progress`;
    const argsWithProgress = args.length >= 2
      ? [...args.slice(0, -1), "-progress", progressFile, args[args.length - 1]]
      : args;

    const progressInterval = setInterval(async () => {
      try {
        const content = await rf(progressFile, "utf8");
        const m = content.match(/out_time=(\d+):(\d+):(\d+\.\d+)/);
        if (m && totalDurationSec > 0) {
          const curSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          const pct = Math.min(95, Math.round((curSec / totalDurationSec) * 100));
          const j = _jobs.get(jobId);
          if (j) j.progress = pct;
        }
      } catch { /* progress file not ready yet */ }
    }, 1000);

    const { spawn: _spawnProc } = await import("child_process");
    const child = _spawnProc(ffmpegBin, argsWithProgress, {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const jProc = _jobs.get(jobId);
    if (jProc) jProc.ffmpegProcess = child;

    try {
      await new Promise<void>((resolve, reject) => {
        child.on("close", (code: number | null) => {
          const j = _jobs.get(jobId);
          if (j?.status === "cancelled") { resolve(); return; }
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg exited ${code}`));
        });
        child.on("error", (err: Error) => {
          const j = _jobs.get(jobId);
          if (j?.status === "cancelled") { resolve(); return; }
          reject(err);
        });
      });
    } finally {
      clearInterval(progressInterval);
      ul(progressFile).catch(() => {});
    }

    const job = _jobs.get(jobId);
    if (job && job.status !== "cancelled") {
      job.status = "done"; job.outputPath = tmpOut; job.progress = 100;
    }
    if (job?.status !== "cancelled") console.log(`[job:${jobId}] ✅ done`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const job = _jobs.get(jobId);
    if (job?.status === "cancelled") {
      console.log(`[job:${jobId}] 🚫 cancelled`);
    } else {
      console.error(`[job:${jobId}] ❌ failed: ${msg.slice(0, 400)}`);
      if (job) { job.status = "failed"; job.error = msg.slice(0, 400); }
    }
    ul(tmpIn).catch(() => {});
    ul(tmpOut).catch(() => {});
  } finally {
    ul(tmpIn).catch(() => {});
    if (sessionDir) rm(sessionDir, { recursive: true, force: true }).catch(() => {});
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ── Static FFmpeg files ──────────────────────────────────────────────────
    if (pathname === "/ffmpeg-core-esm.js") {
      const buf = ffmpegBuf(
        "core-esm-js",
        R("public", "ffmpeg-core-esm.js"),
        R("node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js"),
      );
      if (buf)
        return new Response(buf, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
    }

    if (pathname === "/ffmpeg-core.js") {
      const buf = ffmpegBuf(
        "core-umd-js",
        R("public", "ffmpeg-core.js"),
        R("node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js"),
      );
      if (buf)
        return new Response(buf, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
    }

    if (pathname === "/ffmpeg-core.wasm") {
      const buf = ffmpegBuf(
        "core-wasm",
        R("public", "ffmpeg-core.wasm"),
        R("node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"),
        R("node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm"),
      );
      if (buf)
        return new Response(buf, {
          headers: {
            "Content-Type": "application/wasm",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
    }

    if (pathname === "/ffmpeg-core-mt.js") {
      const buf = ffmpegBuf(
        "core-mt-js",
        R("public", "ffmpeg-core-mt.js"),
        R("node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.js"),
      );
      if (buf)
        return new Response(buf, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
    }

    if (pathname === "/ffmpeg-core-mt.wasm") {
      const buf = ffmpegBuf(
        "core-mt-wasm",
        R("public", "ffmpeg-core-mt.wasm"),
        R("node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm"),
      );
      if (buf)
        return new Response(buf, {
          headers: {
            "Content-Type": "application/wasm",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
    }

    if (pathname === "/ffmpeg-core-mt.worker.js") {
      const buf = ffmpegBuf(
        "core-mt-worker",
        R("public", "ffmpeg-core-mt.worker.js"),
        R("node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js"),
      );
      if (buf)
        return new Response(buf, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
    }

    // ── Chunk Upload API ─────────────────────────────────────────────────────
    if (pathname === "/api/upload-chunk" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const sessionId = formData.get("sessionId") as string;
        const chunkIndex = parseInt(formData.get("chunkIndex") as string, 10);
        const chunkFile = formData.get("chunk");

        if (!sessionId || isNaN(chunkIndex) || !(chunkFile instanceof File)) {
          return new Response(JSON.stringify({ error: "Missing sessionId, chunkIndex, or chunk" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { mkdir, writeFile: wf } = await import("fs/promises");
        const { tmpdir } = await import("os");
        const { join: pj } = await import("path");

        const sessionDir = pj(tmpdir(), "vep-sessions", sessionId);
        await mkdir(sessionDir, { recursive: true });
        const chunkPath = pj(sessionDir, `chunk_${String(chunkIndex).padStart(5, "0")}`);
        await wf(chunkPath, Buffer.from(await chunkFile.arrayBuffer()));

        return new Response(JSON.stringify({ ok: true, received: chunkIndex }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[/api/upload-chunk]", msg);
        return new Response(JSON.stringify({ error: "Chunk upload failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // ── Cloud Enhance API ────────────────────────────────────────────────────
    if (pathname === "/api/enhance" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const mode = (formData.get("mode") as string) || "enhance";
        let settings: Record<string, unknown> = {};
        const settingsRaw = formData.get("settings");
        if (settingsRaw && typeof settingsRaw === "string") {
          try { settings = JSON.parse(settingsRaw) as Record<string, unknown>; } catch { /* ignore */ }
        }

        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const { writeFile: wf, unlink: ul, readFile: rf, readdir, rm } = await import("fs/promises");
        const { existsSync: ex } = await import("fs");
        const { tmpdir } = await import("os");
        const { join: pj } = await import("path");
        const { createRequire } = await import("module");
        const execFileAsync = promisify(execFile);

        // Prefer system ffmpeg; fall back to ffmpeg-static
        let ffmpegBin = "ffmpeg";
        try {
          const { execFileSync } = await import("child_process");
          execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        } catch {
          const _req = createRequire(import.meta.url);
          try {
            const bin: string = _req("ffmpeg-static");
            if (bin && ex(bin)) ffmpegBin = bin;
          } catch { /* keep "ffmpeg" */ }
          if (process.env.FFMPEG_PATH && ex(process.env.FFMPEG_PATH)) {
            ffmpegBin = process.env.FFMPEG_PATH;
          }
        }

        const { buildFFmpegArgs, outputExtForMode, mimeForExt } = await import(
          "../server/build-ffmpeg-args.js"
        ).catch(() => import("../server/build-ffmpeg-args.ts"));

        const ext = outputExtForMode(mode);
        const ts = Date.now();
        const tmpIn = pj(tmpdir(), `cloud-in-${ts}.mp4`);
        const tmpOut = pj(tmpdir(), `cloud-out-${ts}.${ext}`);
        let sessionDir: string | null = null;

        try {
          const sessionId = formData.get("sessionId") as string | null;
          const totalChunks = parseInt((formData.get("totalChunks") as string) ?? "0", 10);

          if (sessionId && totalChunks > 0) {
            // Chunked upload: assemble from stored chunks
            sessionDir = pj(tmpdir(), "vep-sessions", sessionId);
            const files = await readdir(sessionDir);
            const chunkFiles = files.filter((f) => f.startsWith("chunk_")).sort();

            if (chunkFiles.length !== totalChunks) {
              return new Response(JSON.stringify({
                error: `توقعنا ${totalChunks} جزء، استُلم ${chunkFiles.length}`,
              }), { status: 400, headers: { "Content-Type": "application/json" } });
            }

            const parts: Buffer[] = [];
            for (const cf of chunkFiles) {
              parts.push(await rf(pj(sessionDir, cf)));
            }
            await wf(tmpIn, Buffer.concat(parts));
            console.log(`[/api/enhance] assembled ${chunkFiles.length} chunks → ${tmpIn}`);
          } else {
            // Direct upload (small file)
            const videoFile = formData.get("file");
            if (!videoFile || !(videoFile instanceof File)) {
              return new Response(JSON.stringify({ error: "لم يُرسل ملف أو جلسة رفع" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              });
            }
            await wf(tmpIn, Buffer.from(await videoFile.arrayBuffer()));
          }

          const args = buildFFmpegArgs(mode, settings as Parameters<typeof buildFFmpegArgs>[1], tmpIn, tmpOut);
          console.log(`[/api/enhance] mode=${mode} ffmpeg`, args.join(" "));

          await execFileAsync(ffmpegBin, args, {
            maxBuffer: 500 * 1024 * 1024,
            timeout: 15 * 60 * 1000,
          } as object);

          const outBuf = await rf(tmpOut);
          const ab = outBuf.buffer.slice(outBuf.byteOffset, outBuf.byteOffset + outBuf.byteLength);
          const mime = mimeForExt(ext);

          return new Response(ab, {
            status: 200,
            headers: {
              "Content-Type": mime,
              "Content-Disposition": `attachment; filename="enhanced.${ext}"`,
              "Cross-Origin-Resource-Policy": "cross-origin",
            },
          });
        } finally {
          ul(tmpIn).catch(() => {});
          ul(tmpOut).catch(() => {});
          if (sessionDir) rm(sessionDir, { recursive: true, force: true }).catch(() => {});
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[/api/enhance]", msg);
        return new Response(JSON.stringify({ error: "فشلت المعالجة عبر السيرفر", detail: msg.slice(0, 500) }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // ── Uploaded video files API ─────────────────────────────────────────────
    if (pathname.startsWith("/api/videos/")) {
      const fileName = decodeURIComponent(pathname.slice("/api/videos/".length));
      if (fileName && !fileName.includes("..")) {
        const filePath = R("uploads", fileName);
        if (existsSync(filePath)) {
          const buf = await readFile(filePath);
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
          const mime =
            ext === "mp4"
              ? "video/mp4"
              : ext === "webm"
                ? "video/webm"
                : ext === "gif"
                  ? "image/gif"
                  : ext === "mp3"
                    ? "audio/mpeg"
                    : ext === "wav"
                      ? "audio/wav"
                      : "application/octet-stream";
          return new Response(ab, {
            status: 200,
            headers: {
              "Content-Type": mime,
              "Content-Disposition": `attachment; filename="${fileName.replace(/^[^-]+-/, "")}"`,
              "Cross-Origin-Resource-Policy": "cross-origin",
            },
          });
        }
        return new Response("Not found", { status: 404 });
      }
    }

    // ── /api/enhance-async — بدء معالجة خلفية، يرجع jobId فوراً ─────────────
    if (pathname === "/api/enhance-async" && request.method === "POST") {
      try {
        const form = await request.formData();
        const mode = (form.get("mode") as string) || "enhance";
        const sessionId = form.get("sessionId") as string | null;
        const totalChunks = parseInt((form.get("totalChunks") as string) ?? "0", 10);
        let settings: Record<string, unknown> = {};
        const raw = form.get("settings");
        if (typeof raw === "string") { try { settings = JSON.parse(raw); } catch { /* ignore */ } }

        let inputBuffer: Buffer | null = null;
        if (!sessionId || !totalChunks) {
          const videoFile = form.get("file");
          if (videoFile instanceof File) {
            inputBuffer = Buffer.from(await videoFile.arrayBuffer());
          }
        }

        const { outputExtForMode } = await import("../server/build-ffmpeg-args.js")
          .catch(() => import("../server/build-ffmpeg-args.ts"));
        const ext: string = typeof outputExtForMode === "function"
          ? outputExtForMode(mode)
          : (mode === "extract-audio" ? "mp3" : mode === "gif" ? "gif" : mode === "thumbnail" ? "jpg" : "mp4");

        const jobId = crypto.randomUUID();
        _jobs.set(jobId, { status: "processing", ext, createdAt: Date.now() });

        runEnhanceJob(jobId, mode, settings, inputBuffer, sessionId, totalChunks, ext)
          .catch((err) => console.error("[enhance-async] unexpected:", err));

        return new Response(JSON.stringify({ jobId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: msg }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // ── /api/job/:id — حالة الـ job ─────────────────────────────────────────
    if (pathname.startsWith("/api/job/") && !pathname.includes("/result") && request.method === "GET") {
      const jobId = pathname.slice("/api/job/".length);
      const job = _jobs.get(jobId);
      if (!job) {
        return new Response(JSON.stringify({ error: "Job not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ status: job.status, error: job.error, progress: job.progress ?? 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // ── DELETE /api/job/:id — Cancel ─────────────────────────────────────────
    if (pathname.startsWith("/api/job/") && !pathname.includes("/result") && request.method === "DELETE") {
      const jobId = pathname.slice("/api/job/".length);
      const job = _jobs.get(jobId);
      if (!job || job.status !== "processing") {
        return new Response(JSON.stringify({ error: "Job not found or not processing" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      job.status = "cancelled";
      if (job.ffmpegProcess) {
        try { job.ffmpegProcess.kill("SIGTERM"); } catch { /* ignore */ }
        setTimeout(() => { try { job.ffmpegProcess?.kill("SIGKILL"); } catch { /* ignore */ } }, 2000);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── /api/job-result/:id — تحميل النتيجة ─────────────────────────────────
    if (pathname.startsWith("/api/job-result/") && request.method === "GET") {
      const jobId = pathname.slice("/api/job-result/".length);
      const job = _jobs.get(jobId);
      if (!job || job.status !== "done" || !job.outputPath) {
        return new Response(JSON.stringify({ error: "Result not ready" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      try {
        const { readFile } = await import("fs/promises");
        const buf = await readFile(job.outputPath);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        const ext = job.ext;
        const mime =
          ext === "mp3" ? "audio/mpeg"
          : ext === "gif" ? "image/gif"
          : ext === "jpg" ? "image/jpeg"
          : ext === "wav" ? "audio/wav"
          : ext === "webm" ? "video/webm"
          : "video/mp4";
        const outputPath = job.outputPath;
        setTimeout(() => {
          import("fs/promises").then(({ unlink }) => unlink(outputPath).catch(() => {}));
          _jobs.delete(jobId);
        }, 30_000);
        return new Response(ab, {
          status: 200,
          headers: {
            "Content-Type": mime,
            "Content-Length": String(buf.byteLength),
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Failed to read result" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // ── TanStack Start handler ────────────────────────────────────────────────
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return withCrossOriginHeaders(normalized);
    } catch (error) {
      console.error(error);
      return withCrossOriginHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
