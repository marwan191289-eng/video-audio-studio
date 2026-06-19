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
        if (req.url !== "/api/enhance" || req.method !== "POST") {
          return next();
        }

        try {
          const [
            { default: Busboy },
            { execFile },
            { promisify },
            { writeFile, readFile, unlink },
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

          // Resolve ffmpeg binary: prefer ffmpeg-static, fallback to system
          let ffmpegBin = "ffmpeg";
          try {
            const _cjsReq = createRequire(import.meta.url);
            const bin = _cjsReq("ffmpeg-static") as string;
            if (bin && existsSync(bin)) ffmpegBin = bin;
          } catch {
            /* use system ffmpeg */
          }

          // Parse multipart form data
          const bb = Busboy({ headers: req.headers });
          let fileBuffer: Buffer | null = null;
          let mode = "enhance";
          const settings: Record<string, unknown> = {};

          bb.on("file", (_field: string, file: any) => {
            const chunks: Buffer[] = [];
            file.on("data", (d: Buffer) => chunks.push(d));
            file.on("end", () => {
              fileBuffer = Buffer.concat(chunks);
            });
          });

          bb.on("field", (name: string, value: string) => {
            if (name === "mode") mode = value;
            if (name === "settings") {
              try {
                const parsed = JSON.parse(value) as Record<string, unknown>;
                Object.assign(settings, parsed);
              } catch {
                /* ignore */
              }
            }
          });

          await new Promise<void>((resolve, reject) => {
            bb.on("finish", resolve);
            bb.on("error", reject);
            req.pipe(bb);
          });

          if (!fileBuffer) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "لم يتم إرسال ملف فيديو" }));
            return;
          }

          const { buildFFmpegArgs, outputExtForMode, mimeForExt } = await import(
            "./server/build-ffmpeg-args.js"
          ).catch(() => import("./server/build-ffmpeg-args.ts"));

          const ext = outputExtForMode(mode);
          const ts = Date.now();
          const tmpIn = join(tmpdir(), `cloud-in-${ts}.mp4`);
          const tmpOut = join(tmpdir(), `cloud-out-${ts}.${ext}`);

          try {
            await writeFile(tmpIn, fileBuffer);

            const args = buildFFmpegArgs(mode, settings as any, tmpIn, tmpOut);
            console.log(`[/api/enhance] mode=${mode} ffmpeg`, args.join(" "));

            await execFileAsync(ffmpegBin, args, {
              maxBuffer: 500 * 1024 * 1024,
              timeout: 5 * 60 * 1000,
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
            res.end(
              JSON.stringify({ error: "فشلت معالجة الفيديو", detail: msg.slice(0, 500) }),
            );
          } finally {
            unlink(tmpIn).catch(() => {});
            unlink(tmpOut).catch(() => {});
          }
        } catch (err) {
          console.error("[/api/enhance dev] setup error:", err);
          next(err);
        }
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
