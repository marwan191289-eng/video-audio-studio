---
name: FFmpeg.wasm setup in Replit
description: How to correctly set up FFmpeg.wasm (@ffmpeg/ffmpeg v0.12.x) in Replit's TanStack Start environment
---

# FFmpeg.wasm in Replit — Correct Setup

## The Problem

`@ffmpeg/core` was not installed. The code was fetching from `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd` which fails in Replit's sandbox environment with error: `failed to import ffmpeg-core.js`.

## The Fix

### 1. Install @ffmpeg/core

```
bun add @ffmpeg/core@0.12.6
```

### 2. Copy core files to public/

```
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js public/
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm public/
```

### 3. ffmpeg-client.ts — use local paths + toBlobURL

```ts
import { toBlobURL } from "@ffmpeg/util";
const coreURL = await toBlobURL("/ffmpeg-core.js", "text/javascript");
await ffmpeg.load({ coreURL, wasmURL: "/ffmpeg-core.wasm" });
```

**Why toBlobURL for JS:** ffmpeg-core.js is a UMD bundle (not ES module). Dynamic import() needs a blob URL with text/javascript MIME type to work. wasmURL can be a direct path.

### 4. COOP/COEP Headers — two layers needed

**vite.config.ts** (for Vite's dev static file server):

```ts
server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } }
```

**server.ts** (for SSR responses through Replit proxy):
Intercept all responses and add COOP/COEP headers. Also serve /ffmpeg-core.js and /ffmpeg-core.wasm directly from node_modules as a fallback.

**Why:** The @lovable.dev/vite-tanstack-config wrapper may strip headers in sandbox mode. Adding them at the server.ts level ensures they survive the Replit proxy.

## Verification

```
curl -I http://localhost:5000/ffmpeg-core.js  # must return 200 with text/javascript
curl -I http://localhost:5000/ffmpeg-core.wasm  # must return 200 with application/wasm
```

## Warning

After adding @ffmpeg/core, run `bun install` and restart the workflow — Vite needs to re-optimize dependencies.
