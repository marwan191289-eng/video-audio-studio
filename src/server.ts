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

    // ── Cloud Enhance API ────────────────────────────────────────────────────
    if (pathname === "/api/enhance" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const videoFile = formData.get("file");
        if (!videoFile || !(videoFile instanceof File)) {
          return new Response(JSON.stringify({ error: "لم يتم إرسال ملف فيديو" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const mode = (formData.get("mode") as string) || "enhance";
        let settings: Record<string, unknown> = {};
        const settingsRaw = formData.get("settings");
        if (settingsRaw && typeof settingsRaw === "string") {
          try {
            settings = JSON.parse(settingsRaw) as Record<string, unknown>;
          } catch {
            /* ignore */
          }
        }

        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const { writeFile: wf, unlink: ul, readFile: rf } = await import("fs/promises");
        const { existsSync: ex } = await import("fs");
        const { tmpdir } = await import("os");
        const { join: pj } = await import("path");
        const { createRequire } = await import("module");
        const execFileAsync = promisify(execFile);

        // Resolve ffmpeg binary: prefer system ffmpeg, fallback to ffmpeg-static
        let ffmpegBin = "ffmpeg";
        try {
          const { execFileSync } = await import("child_process");
          execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        } catch {
          const _req = createRequire(import.meta.url);
          try {
            const bin: string = _req("ffmpeg-static");
            if (bin && ex(bin)) ffmpegBin = bin;
          } catch {
            /* use system ffmpeg anyway */
          }
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

        try {
          await wf(tmpIn, Buffer.from(await videoFile.arrayBuffer()));

          const args = buildFFmpegArgs(mode, settings as Parameters<typeof buildFFmpegArgs>[1], tmpIn, tmpOut);
          console.log(`[/api/enhance] mode=${mode} ffmpeg`, args.join(" "));

          await execFileAsync(ffmpegBin, args, {
            maxBuffer: 500 * 1024 * 1024,
            timeout: 5 * 60 * 1000,
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
