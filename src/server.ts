import "./lib/error-capture";
import { readFileSync } from "fs";
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

/** Headers required for SharedArrayBuffer (FFmpeg.wasm) */
const COOP_COEP = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

/** Add COOP/COEP to any Response */
function withCrossOriginHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(COOP_COEP)) {
    headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Cached FFmpeg core file buffers — read once from node_modules */
let _coreJs: Buffer | null = null;
let _coreWasm: Buffer | null = null;

function getFFmpegFile(name: "js" | "wasm"): Buffer | null {
  try {
    const coreDir = join(process.cwd(), "node_modules/@ffmpeg/core/dist/umd");
    if (name === "js") {
      if (!_coreJs) _coreJs = readFileSync(join(coreDir, "ffmpeg-core.js"));
      return _coreJs;
    } else {
      if (!_coreWasm) _coreWasm = readFileSync(join(coreDir, "ffmpeg-core.wasm"));
      return _coreWasm;
    }
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);
    const { pathname } = url;

    // ── Serve FFmpeg core files with correct MIME + CORP headers ──────────
    if (pathname === "/ffmpeg-core.js") {
      const buf = getFFmpegFile("js");
      if (buf) {
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
      }
    }

    if (pathname === "/ffmpeg-core.wasm") {
      const buf = getFFmpegFile("wasm");
      if (buf) {
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": "application/wasm",
            "Cache-Control": "public, max-age=86400",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
      }
    }

    // ── Normal TanStack Start handler ─────────────────────────────────────
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
