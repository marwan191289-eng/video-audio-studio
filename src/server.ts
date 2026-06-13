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

/**
 * Headers required for SharedArrayBuffer — enables FFmpeg multi-threading.
 * Without these, the browser denies access to SharedArrayBuffer and FFmpeg
 * falls back to single-threaded WASM (4-8× slower).
 */
const COOP_COEP = {
  "Cross-Origin-Opener-Policy":   "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

/** Inject COOP/COEP into every response */
function withCrossOriginHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(COOP_COEP)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ── FFmpeg file cache (read once from disk / node_modules) ──────────────────

type FFmpegFileKey =
  | "core-esm-js" | "core-umd-js" | "core-wasm"
  | "core-mt-js"  | "core-mt-wasm" | "core-mt-worker";

const _cache = new Map<FFmpegFileKey, Buffer>();

function ffmpegBuf(key: FFmpegFileKey, ...candidates: string[]): Buffer | null {
  if (_cache.has(key)) return _cache.get(key)!;
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const buf = readFileSync(p);
        _cache.set(key, buf);
        return buf;
      } catch { /* continue */ }
    }
  }
  return null;
}

/** Resolve a file path relative to project root */
const R = (...parts: string[]) => join(process.cwd(), ...parts);

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url      = new URL(request.url);
    const pathname = url.pathname;

    // ── Static FFmpeg files ─────────────────────────────────────────────────
    //
    // Priority: public/ directory first (always present after npm run build),
    // then node_modules fallbacks for local dev.

    // Single-thread ESM build (always available)
    if (pathname === "/ffmpeg-core-esm.js") {
      const buf = ffmpegBuf("core-esm-js",
        R("public", "ffmpeg-core-esm.js"),
        R("node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js"),
      );
      if (buf) return new Response(buf, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    if (pathname === "/ffmpeg-core.js") {
      const buf = ffmpegBuf("core-umd-js",
        R("public", "ffmpeg-core.js"),
        R("node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js"),
      );
      if (buf) return new Response(buf, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    if (pathname === "/ffmpeg-core.wasm") {
      const buf = ffmpegBuf("core-wasm",
        R("public", "ffmpeg-core.wasm"),
        R("node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"),
        R("node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm"),
      );
      if (buf) return new Response(buf, {
        headers: {
          "Content-Type": "application/wasm",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    // ── Multi-thread build files (4-8× faster when SharedArrayBuffer is available) ─
    if (pathname === "/ffmpeg-core-mt.js") {
      const buf = ffmpegBuf("core-mt-js",
        R("public", "ffmpeg-core-mt.js"),
        R("node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.js"),
      );
      if (buf) return new Response(buf, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    if (pathname === "/ffmpeg-core-mt.wasm") {
      const buf = ffmpegBuf("core-mt-wasm",
        R("public", "ffmpeg-core-mt.wasm"),
        R("node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm"),
      );
      if (buf) return new Response(buf, {
        headers: {
          "Content-Type": "application/wasm",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    if (pathname === "/ffmpeg-core-mt.worker.js") {
      const buf = ffmpegBuf("core-mt-worker",
        R("public", "ffmpeg-core-mt.worker.js"),
        R("node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js"),
      );
      if (buf) return new Response(buf, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    // ── Uploaded video files API ─────────────────────────────────────────────
    if (pathname.startsWith("/api/videos/")) {
      const fileName = decodeURIComponent(pathname.slice("/api/videos/".length));
      if (fileName && !fileName.includes("..")) {
        const filePath = R("uploads", fileName);
        if (existsSync(filePath)) {
          const buf = await readFile(filePath);
          const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
          const mime =
            ext === "mp4"  ? "video/mp4"           :
            ext === "webm" ? "video/webm"           :
            ext === "gif"  ? "image/gif"            :
            ext === "mp3"  ? "audio/mpeg"           :
            ext === "wav"  ? "audio/wav"            :
            "application/octet-stream";
          return new Response(buf, {
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
      const handler  = await getServerEntry();
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
