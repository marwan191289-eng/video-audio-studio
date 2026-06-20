import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { Plugin } from "vite";

function cloudEnhanceDevPlugin(): Plugin {
  // In-memory job store for async processing
  const _jobs: Map<string, {
    status: "processing" | "done" | "failed";
    outputPath?: string;
    ext: string;
    error?: string;
    createdAt: number;
    progress?: number;
    ffmpegProcess?: { kill(signal?: string): boolean };
  }> = new Map();

  return {
    name: "api-enhance-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url as string;
        const method = req.method as string;
        const pathname = url.split("?")[0];

        // ── POST /api/upload-chunk ─────────────────────────────────────────
        if (pathname === "/api/upload-chunk" && method === "POST") {
          try {
            const [
              { default: Busboy },
              { mkdir, writeFile },
              { tmpdir },
              { join },
            ] = await Promise.all([
              import("busboy"),
              import("fs/promises"),
              import("os"),
              import("path"),
            ]);

            const bb = Busboy({ headers: req.headers });
            let sessionId = "";
            let chunkIndex = 0;
            let chunkBuffer: Buffer | null = null;

            bb.on("file", (_field: string, file: any) => {
              const parts: Buffer[] = [];
              file.on("data", (d: Buffer) => parts.push(d));
              file.on("end", () => { chunkBuffer = Buffer.concat(parts); });
            });

            bb.on("field", (name: string, value: string) => {
              if (name === "sessionId") sessionId = value;
              if (name === "chunkIndex") chunkIndex = parseInt(value, 10);
            });

            await new Promise<void>((resolve, reject) => {
              bb.on("finish", resolve);
              bb.on("error", reject);
              req.pipe(bb);
            });

            if (!sessionId || !chunkBuffer) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing sessionId or chunk data" }));
              return;
            }

            const sessionDir = join(tmpdir(), "vep-sessions", sessionId);
            await mkdir(sessionDir, { recursive: true });
            const chunkFile = join(sessionDir, `chunk_${String(chunkIndex).padStart(5, "0")}`);
            await writeFile(chunkFile, chunkBuffer);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, received: chunkIndex }));
          } catch (err) {
            console.error("[/api/upload-chunk dev]", err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Chunk upload failed" }));
          }
          return;
        }

        // ── POST /api/enhance-async ────────────────────────────────────────
        if (pathname === "/api/enhance-async" && method === "POST") {
          try {
            const [
              { default: Busboy },
              { tmpdir },
              { join },
            ] = await Promise.all([
              import("busboy"),
              import("os"),
              import("path"),
            ]);

            const bb = Busboy({ headers: req.headers });
            let fileBuffer: Buffer | null = null;
            let sessionId = "";
            let totalChunks = 0;
            let mode = "enhance";
            const settings: Record<string, unknown> = {};

            bb.on("file", (_field: string, file: any) => {
              const parts: Buffer[] = [];
              file.on("data", (d: Buffer) => parts.push(d));
              file.on("end", () => { fileBuffer = Buffer.concat(parts); });
            });

            bb.on("field", (name: string, value: string) => {
              if (name === "mode") mode = value;
              if (name === "sessionId") sessionId = value;
              if (name === "totalChunks") totalChunks = parseInt(value, 10);
              if (name === "settings") {
                try { Object.assign(settings, JSON.parse(value)); } catch { /* ignore */ }
              }
            });

            await new Promise<void>((resolve, reject) => {
              bb.on("finish", resolve);
              bb.on("error", reject);
              req.pipe(bb);
            });

            const { outputExtForMode } = await import("./server/build-ffmpeg-args.ts");
            const ext: string = typeof outputExtForMode === "function"
              ? outputExtForMode(mode)
              : (mode === "extract-audio" ? "mp3" : mode === "gif" ? "gif" : mode === "thumbnail" ? "jpg" : "mp4");

            const jobId = crypto.randomUUID();
            _jobs.set(jobId, { status: "processing", ext, createdAt: Date.now() });

            // Run job in background (fire-and-forget)
            const _sid = sessionId;
            const _tc = totalChunks;
            const _fb = fileBuffer;
            const _mode = mode;
            const _settings = settings;
            const _ext = ext;
            const _jobId = jobId;

            (async () => {
              const { execFile } = await import("child_process");
              const { promisify } = await import("util");
              const { writeFile: wf, readFile: rf, unlink: ul, readdir, rm } = await import("fs/promises");
              const { existsSync: ex } = await import("fs");
              const { createRequire } = await import("module");
              const execFileAsync = promisify(execFile);

              let ffmpegBin = "ffmpeg";
              try {
                const { execFileSync } = await import("child_process");
                execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
              } catch {
                try {
                  const _cjsReq = createRequire(import.meta.url);
                  const bin = _cjsReq("ffmpeg-static") as string;
                  if (bin && ex(bin)) ffmpegBin = bin;
                } catch { /* ignore */ }
                if (process.env.FFMPEG_PATH && ex(process.env.FFMPEG_PATH)) {
                  ffmpegBin = process.env.FFMPEG_PATH;
                }
              }

              const { buildFFmpegArgs } = await import("./server/build-ffmpeg-args.ts");
              const ts = Date.now();
              const tmpIn = join(tmpdir(), `job-in-${ts}.mp4`);
              const tmpOut = join(tmpdir(), `job-out-${ts}.${_ext}`);
              let sessionDir: string | null = null;

              try {
                if (_sid && _tc > 0) {
                  sessionDir = join(tmpdir(), "vep-sessions", _sid);
                  const files = await readdir(sessionDir);
                  const chunkFiles = files.filter((f) => f.startsWith("chunk_")).sort();
                  if (chunkFiles.length !== _tc) {
                    throw new Error(`Expected ${_tc} chunks, received ${chunkFiles.length}`);
                  }
                  const parts: Buffer[] = [];
                  for (const cf of chunkFiles) parts.push(await rf(join(sessionDir, cf)));
                  await wf(tmpIn, Buffer.concat(parts));
                } else if (_fb) {
                  await wf(tmpIn, _fb);
                } else {
                  throw new Error("No data to process");
                }

                const args = buildFFmpegArgs(_mode, _settings as Parameters<typeof buildFFmpegArgs>[1], tmpIn, tmpOut);
                console.log(`[job:${_jobId}] mode=${_mode} ffmpeg ${args.slice(0, 6).join(" ")} ...`);

                // ── Real-time progress tracking ──────────────────────────
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
                    const content = (await rf(progressFile)).toString("utf8");
                    const m = content.match(/out_time=(\d+):(\d+):(\d+\.\d+)/);
                    if (m && totalDurationSec > 0) {
                      const curSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
                      const pct = Math.min(95, Math.round((curSec / totalDurationSec) * 100));
                      const j = _jobs.get(_jobId);
                      if (j) j.progress = pct;
                    }
                  } catch { /* progress file not ready yet */ }
                }, 1000);

                const { spawn: _spawn } = await import("child_process");
                const child = _spawn(ffmpegBin, argsWithProgress, {
                  stdio: ["ignore", "ignore", "ignore"],
                });
                const jProc = _jobs.get(_jobId);
                if (jProc) jProc.ffmpegProcess = child;

                try {
                  await new Promise<void>((resolve, reject) => {
                    child.on("close", (code: number | null) => {
                      const j = _jobs.get(_jobId);
                      if (j?.status === "cancelled") { resolve(); return; }
                      if (code === 0) resolve();
                      else reject(new Error(`FFmpeg exited ${code}`));
                    });
                    child.on("error", (err: Error) => {
                      const j = _jobs.get(_jobId);
                      if (j?.status === "cancelled") { resolve(); return; }
                      reject(err);
                    });
                  });
                } finally {
                  clearInterval(progressInterval);
                  ul(progressFile).catch(() => {});
                }

                const job = _jobs.get(_jobId);
                if (job && job.status !== "cancelled") {
                  job.status = "done"; job.outputPath = tmpOut; job.progress = 100;
                }
                if (job?.status !== "cancelled") console.log(`[job:${_jobId}] ✅ done`);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const job = _jobs.get(_jobId);
                if (job?.status === "cancelled") {
                  console.log(`[job:${_jobId}] 🚫 cancelled`);
                } else {
                  console.error(`[job:${_jobId}] ❌ failed: ${msg.slice(0, 400)}`);
                  if (job) { job.status = "failed"; job.error = msg.slice(0, 400); }
                }
                ul(tmpIn).catch(() => {});
                ul(tmpOut).catch(() => {});
              } finally {
                ul(tmpIn).catch(() => {});
                if (sessionDir) rm(sessionDir, { recursive: true, force: true }).catch(() => {});
              }
            })().catch((err) => console.error("[enhance-async dev] unexpected:", err));

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jobId }));
          } catch (err) {
            console.error("[/api/enhance-async dev]", err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
          }
          return;
        }

        // ── GET /api/job/:id ───────────────────────────────────────────────
        if (pathname.startsWith("/api/job/") && !pathname.includes("/result") && method === "GET") {
          const jobId = pathname.slice("/api/job/".length);
          const job = _jobs.get(jobId);
          if (!job) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Job not found" }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify({ status: job.status, error: job.error, progress: job.progress ?? 0 }));
          }
          return;
        }

        // ── DELETE /api/job/:id — Cancel ──────────────────────────────────
        if (pathname.startsWith("/api/job/") && !pathname.includes("/result") && method === "DELETE") {
          const jobId = pathname.slice("/api/job/".length);
          const job = _jobs.get(jobId);
          if (!job || job.status !== "processing") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Job not found or not processing" }));
          } else {
            job.status = "cancelled";
            if (job.ffmpegProcess) {
              try { job.ffmpegProcess.kill("SIGTERM"); } catch { /* ignore */ }
              setTimeout(() => { try { job.ffmpegProcess?.kill("SIGKILL"); } catch { /* ignore */ } }, 2000);
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          }
          return;
        }

        // ── GET /api/job-result/:id ────────────────────────────────────────
        if (pathname.startsWith("/api/job-result/") && method === "GET") {
          const jobId = pathname.slice("/api/job-result/".length);
          const job = _jobs.get(jobId);
          if (!job || job.status !== "done" || !job.outputPath) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Result not ready" }));
            return;
          }
          try {
            const { readFile } = await import("fs/promises");
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
            setTimeout(() => {
              import("fs/promises").then(({ unlink }) => unlink(outputPath).catch(() => {}));
              _jobs.delete(jobId);
            }, 30_000);
            res.writeHead(200, {
              "Content-Type": mime,
              "Content-Length": String(buf.length),
              "Cross-Origin-Resource-Policy": "cross-origin",
            });
            res.end(buf);
          } catch {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to read result" }));
          }
          return;
        }

        // ── POST /api/enhance (sync fallback) ──────────────────────────────
        if (pathname === "/api/enhance" && method === "POST") {
          try {
            const [
              { default: Busboy },
              { execFile },
              { promisify },
              { writeFile, readFile, unlink, rm, readdir },
              { tmpdir },
              { join },
              { createRequire },
              { existsSync },
            ] = await Promise.all([
              import("busboy"),
              import("child_process"),
              import("util"),
              import("fs/promises"),
              import("os"),
              import("path"),
              import("module"),
              import("fs"),
            ]);

            const execFileAsync = promisify(execFile as any) as (
              cmd: string,
              args: string[],
              opts?: object,
            ) => Promise<{ stdout: string; stderr: string }>;

            let ffmpegBin = "ffmpeg";
            try {
              const { execFileSync } = await import("child_process");
              execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
            } catch {
              try {
                const _cjsReq = createRequire(import.meta.url);
                const bin = _cjsReq("ffmpeg-static") as string;
                if (bin && existsSync(bin)) ffmpegBin = bin;
              } catch { /* keep "ffmpeg" */ }
            }

            const bb = Busboy({ headers: req.headers });
            let fileBuffer: Buffer | null = null;
            let sessionId = "";
            let totalChunks = 0;
            let mode = "enhance";
            const settings: Record<string, unknown> = {};

            bb.on("file", (_field: string, file: any) => {
              const parts: Buffer[] = [];
              file.on("data", (d: Buffer) => parts.push(d));
              file.on("end", () => { fileBuffer = Buffer.concat(parts); });
            });

            bb.on("field", (name: string, value: string) => {
              if (name === "mode") mode = value;
              if (name === "sessionId") sessionId = value;
              if (name === "totalChunks") totalChunks = parseInt(value, 10);
              if (name === "settings") {
                try { Object.assign(settings, JSON.parse(value)); } catch { /* ignore */ }
              }
            });

            await new Promise<void>((resolve, reject) => {
              bb.on("finish", resolve);
              bb.on("error", reject);
              req.pipe(bb);
            });

            const { buildFFmpegArgs, outputExtForMode, mimeForExt } = await import(
              "./server/build-ffmpeg-args.ts"
            );

            const ext = outputExtForMode(mode);
            const ts = Date.now();
            const tmpIn = join(tmpdir(), `cloud-in-${ts}.mp4`);
            const tmpOut = join(tmpdir(), `cloud-out-${ts}.${ext}`);
            let sessionDir: string | null = null;

            try {
              if (sessionId && totalChunks > 0) {
                sessionDir = join(tmpdir(), "vep-sessions", sessionId);
                const files = await readdir(sessionDir);
                const chunkFiles = files.filter((f) => f.startsWith("chunk_")).sort();

                if (chunkFiles.length !== totalChunks) {
                  res.writeHead(400, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({
                    error: `Expected ${totalChunks} chunks, received ${chunkFiles.length}`,
                  }));
                  return;
                }

                const parts: Buffer[] = [];
                for (const cf of chunkFiles) {
                  parts.push(await readFile(join(sessionDir, cf)));
                }
                await writeFile(tmpIn, Buffer.concat(parts));
                console.log(`[/api/enhance] assembled ${chunkFiles.length} chunks → ${tmpIn}`);
              } else if (fileBuffer) {
                await writeFile(tmpIn, fileBuffer);
              } else {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "No file or session provided" }));
                return;
              }

              const args = buildFFmpegArgs(mode, settings as any, tmpIn, tmpOut);
              console.log(`[/api/enhance] mode=${mode} ffmpeg`, args.join(" "));

              await execFileAsync(ffmpegBin, args, {
                maxBuffer: 500 * 1024 * 1024,
                timeout: 15 * 60 * 1000,
              });

              const outBuf = await readFile(tmpOut);
              const mime = mimeForExt(ext);

              res.writeHead(200, {
                "Content-Type": mime,
                "Content-Length": outBuf.length,
                "Content-Disposition": `attachment; filename="enhanced.${ext}"`,
                "Cross-Origin-Resource-Policy": "cross-origin",
              });
              res.end(outBuf);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error("[/api/enhance dev] FFmpeg error:", msg.slice(0, 1000));
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Video processing failed", detail: msg.slice(0, 500) }));
            } finally {
              unlink(tmpIn).catch(() => {});
              unlink(tmpOut).catch(() => {});
              if (sessionDir) rm(sessionDir, { recursive: true, force: true }).catch(() => {});
            }
          } catch (err) {
            console.error("[/api/enhance dev] setup error:", err);
            next(err);
          }
          return;
        }

        return next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    cloudEnhanceDevPlugin(),
    tanstackStart({
      server: { entry: "src/server.ts" },
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  server: {
    port: 5000,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    watch: {
      ignored: [
        "**/.cache/**",
        "**/node_modules/**",
        "**/.git/**",
      ],
    },
  },
  build: {
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("@ffmpeg/")) return "ffmpeg";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("recharts") || id.includes("d3")) return "charts";
        },
      },
    },
  },
  optimizeDeps: {
    include: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
});
