---
name: FFmpeg.wasm root cause fix
description: Why ALL ffmpeg operations fail in Replit and the exact 2-layer fix.
---

## The Rule

Use the **ESM build** of `@ffmpeg/core` for `coreURL`, and wrap both files in `toBlobURL`.

```ts
// 1. Copy node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js → public/ffmpeg-core-esm.js
// 2. Use:
const [coreURL, wasmURL] = await Promise.all([
  toBlobURL("/ffmpeg-core-esm.js", "text/javascript"),
  toBlobURL("/ffmpeg-core.wasm", "application/wasm"),
]);
await ffmpeg.load({ coreURL, wasmURL });
```

**Why (layered):**

**Layer 1 — Module worker cannot use importScripts:**  
When Vite processes `@ffmpeg/ffmpeg`, it resolves the ESM build (`dist/esm/classes.js`), which creates a **module Web Worker** (`new Worker(url, { type: 'module' })`). Module workers do NOT support `importScripts()`. The worker's `load()` function tries `importScripts(coreURL)` first — this throws silently — then falls back to `self.createFFmpegCore = (await import(coreURL)).default`.

**Layer 2 — UMD has no `export default`:**  
The `import(coreURL).default` call needs an ES module with `export default createFFmpegCore`. The UMD build (`dist/umd/ffmpeg-core.js`) has no `export` statements, so `.default === undefined`. The worker then throws `ERROR_IMPORT_FAILURE` = "failed to import ffmpeg-core.js".

**Layer 3 — Direct URLs have CORS/MIME issues in Replit proxy:**  
Even with the ESM fix, passing raw `/path` strings for the wasm URL can fail because Replit's proxy may not set `application/wasm` MIME type. `toBlobURL` fetches once and creates a `blob://` URL the browser accepts unconditionally.

**Fix confirmation:**  
`node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js` contains `export default createFFmpegCore` at line 16 AND at the end of the file. Copy it to `public/ffmpeg-core-esm.js` and use it as `coreURL`.

**How to apply:** Any future project using `@ffmpeg/ffmpeg` + Vite must use the ESM `@ffmpeg/core` build. Never use the UMD build as `coreURL`. Both URLs must be blob-wrapped.
