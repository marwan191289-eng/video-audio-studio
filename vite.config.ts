import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { Plugin } from "vite";

function cloudEnhanceDevPlugin(): Plugin {
  return {
    name: "api-enhance-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url as string;
        const method = req.method as string;

        // ── POST /api/upload-chunk ─────────────────────────────────────────
        if (url === "/api/upload-chunk" && method === "POST") {
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

        // ── POST /api/enhance ──────────────────────────────────────────────
        if (url === "/api/enhance" && method === "POST") {
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

            // Prefer system ffmpeg; fall back to ffmpeg-static
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
              "./server/build-ffmpeg-args.js"
            ).catch(() => import("./server/build-ffmpeg-args.ts"));

            const ext = outputExtForMode(mode);
            const ts = Date.now();
            const tmpIn = join(tmpdir(), `cloud-in-${ts}.mp4`);
            const tmpOut = join(tmpdir(), `cloud-out-${ts}.${ext}`);
            let sessionDir: string | null = null;

            try {
              if (sessionId && totalChunks > 0) {
                // Chunked upload: assemble from stored chunks
                sessionDir = join(tmpdir(), "vep-sessions", sessionId);
                const files = await readdir(sessionDir);
                const chunkFiles = files.filter((f) => f.startsWith("chunk_")).sort();

                if (chunkFiles.length !== totalChunks) {
                  res.writeHead(400, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({
                    error: `توقعنا ${totalChunks} جزء، استُلم ${chunkFiles.length} فقط`,
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
                res.end(JSON.stringify({ error: "لم يُرسل ملف أو جلسة رفع" }));
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
              res.end(JSON.stringify({ error: "فشلت معالجة الفيديو", detail: msg.slice(0, 500) }));
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

        // ── GET /api/temp-files/:sessionId ──────────────────────────────────
        // Serves an assembled input file so Rendi's servers can download it.
        if (url.startsWith("/api/temp-files/") && method === "GET") {
          try {
            const { readFile } = await import("fs/promises");
            const { join } = await import("path");
            const { tmpdir } = await import("os");
            const sessionId = url.replace("/api/temp-files/", "").split("?")[0];
            if (!sessionId || sessionId.includes("/") || sessionId.includes("..")) {
              res.writeHead(400); res.end("Bad request"); return;
            }
            const inputPath = join(tmpdir(), "vep-sessions", sessionId, "input");
            const buf = await readFile(inputPath);
            res.writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Content-Length": buf.length,
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-store",
            });
            res.end(buf);
          } catch (err) {
            console.error("[/api/temp-files]", err);
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
          }
          return;
        }

        // ── POST /api/rendi-enhance ──────────────────────────────────────────
        // Assembles chunks, calls Rendi, polls, proxies output back to client.
        if (url === "/api/rendi-enhance" && method === "POST") {
          let sessionIdForCleanup = "";
          try {
            const {
              readFile, writeFile, readdir, rm,
            } = await import("fs/promises");
            const { join } = await import("path");
            const { tmpdir } = await import("os");

            // Parse JSON body
            const rawBody = await new Promise<Buffer>((resolve, reject) => {
              const parts: Buffer[] = [];
              req.on("data", (d: Buffer) => parts.push(d));
              req.on("end", () => resolve(Buffer.concat(parts)));
              req.on("error", reject);
            });
            const { sessionId, totalChunks, mode, settings } = JSON.parse(
              rawBody.toString(),
            ) as {
              sessionId: string;
              totalChunks: number;
              mode: string;
              settings: Record<string, unknown>;
            };
            sessionIdForCleanup = sessionId;

            // Assemble chunks into a single input file
            const sessionDir = join(tmpdir(), "vep-sessions", sessionId);
            const dirFiles = await readdir(sessionDir);
            const chunkFiles = dirFiles.filter((f) => f.startsWith("chunk_")).sort();

            if (chunkFiles.length !== totalChunks) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: `توقعنا ${totalChunks} جزء، استُلم ${chunkFiles.length} فقط`,
                }),
              );
              return;
            }

            const chunkParts: Buffer[] = [];
            for (const cf of chunkFiles) {
              chunkParts.push(await readFile(join(sessionDir, cf)));
            }
            const inputPath = join(sessionDir, "input");
            await writeFile(inputPath, Buffer.concat(chunkParts));
            console.log(
              `[/api/rendi-enhance] assembled ${chunkFiles.length} chunks → ${inputPath}`,
            );

            // Build ffmpeg command with {{in_1}} / {{out_1}} Rendi placeholders
            const { buildFFmpegArgs, outputExtForMode, mimeForExt } = await import(
              "./server/build-ffmpeg-args.js"
            ).catch(() => import("./server/build-ffmpeg-args.ts"));

            const ext: string = outputExtForMode(mode);
            const args: string[] = buildFFmpegArgs(
              mode,
              settings as any,
              "{{in_1}}",
              "{{out_1}}",
            );
            const ffmpegCommand = args.filter((a: string) => a !== "-y").join(" ");

            // Public URL so Rendi's servers can fetch our assembled file
            const devDomain = process.env.REPLIT_DEV_DOMAIN;
            const protocol = devDomain ? "https" : "http";
            const host = devDomain || "localhost:5000";
            const inputUrl = `${protocol}://${host}/api/temp-files/${sessionId}`;

            const rendiKey = process.env.RENDI_API_KEY;
            if (!rendiKey) throw new Error("RENDI_API_KEY not set in environment");

            console.log(`[/api/rendi-enhance] mode=${mode}`);
            console.log(`[/api/rendi-enhance] command: ${ffmpegCommand}`);
            console.log(`[/api/rendi-enhance] inputUrl: ${inputUrl}`);

            // Submit command to Rendi
            const submitRes = await fetch(
              "https://api.rendi.dev/v1/run-ffmpeg-command",
              {
                method: "POST",
                headers: {
                  "X-Api-Key": rendiKey,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  input_files: { in_1: inputUrl },
                  output_files: { out_1: `output.${ext}` },
                  ffmpeg_command: ffmpegCommand,
                }),
              },
            );

            if (!submitRes.ok) {
              const errTxt = await submitRes.text().catch(() => String(submitRes.status));
              throw new Error(`Rendi submit failed (${submitRes.status}): ${errTxt}`);
            }

            const { command_id: commandId } = (await submitRes.json()) as {
              command_id: string;
            };
            console.log(`[/api/rendi-enhance] commandId=${commandId}`);

            // Poll until SUCCESS or FAILED (max 10 min, every 5 s)
            let storageUrl: string | null = null;
            for (let i = 0; i < 120; i++) {
              await new Promise<void>((r) => setTimeout(r, 5_000));
              const pollRes = await fetch(
                `https://api.rendi.dev/v1/commands/${commandId}`,
                { headers: { "X-Api-Key": rendiKey } },
              );
              const data = (await pollRes.json()) as Record<string, any>;
              const status: string = data.status ?? "UNKNOWN";
              console.log(`[/api/rendi-enhance] poll ${i + 1}: ${status}`);

              if (status === "SUCCESS") {
                storageUrl = data.output_files?.out_1?.storage_url ?? null;
                break;
              }
              if (status === "FAILED") {
                throw new Error(
                  data.error_message || "Rendi processing failed",
                );
              }
            }

            if (!storageUrl) {
              throw new Error("Rendi processing timed out after 10 minutes");
            }

            console.log(`[/api/rendi-enhance] downloading output: ${storageUrl}`);

            // Proxy the processed file back to the client
            const dlRes = await fetch(storageUrl);
            const dlBuf = Buffer.from(await dlRes.arrayBuffer());
            const mime: string = mimeForExt(ext);

            res.writeHead(200, {
              "Content-Type": mime,
              "Content-Length": dlBuf.length,
              "Content-Disposition": `attachment; filename="enhanced.${ext}"`,
              "Cross-Origin-Resource-Policy": "cross-origin",
            });
            res.end(dlBuf);

            // Cleanup session dir
            rm(join(tmpdir(), "vep-sessions", sessionId), {
              recursive: true,
              force: true,
            }).catch(() => {});
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[/api/rendi-enhance]", msg);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: msg }));
            }
            // Still cleanup on error
            if (sessionIdForCleanup) {
              const { rm } = await import("fs/promises");
              const { join } = await import("path");
              const { tmpdir } = await import("os");
              rm(join(tmpdir(), "vep-sessions", sessionIdForCleanup), {
                recursive: true,
                force: true,
              }).catch(() => {});
            }
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
