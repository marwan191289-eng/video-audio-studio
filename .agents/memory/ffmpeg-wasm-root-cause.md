---
name: FFmpeg.wasm root cause fix
description: Why ALL ffmpeg operations fail in Replit and the exact fix pattern.
---

## The Rule

Both `coreURL` and `wasmURL` MUST be wrapped in `toBlobURL` before passing to `ffmpeg.load()`.

```ts
const [coreURL, wasmURL] = await Promise.all([
  toBlobURL("/ffmpeg-core.js", "text/javascript"),
  toBlobURL("/ffmpeg-core.wasm", "application/wasm"),
]);
await ffmpeg.load({ coreURL, wasmURL });
```

**Why:** Replit's preview pane is a proxied iframe. When FFmpeg.wasm internally `fetch()`es the `.wasm` file via a direct URL string, the response comes through the proxy without a guaranteed `application/wasm` MIME type. Browsers reject WASM modules with wrong MIME types silently or with a cryptic `TypeError`. `toBlobURL` fetches once, stores as a local `blob://` URL with the correct type, then FFmpeg loads from that blob — no proxy, no MIME issue.

**How to apply:** Any time `ffmpeg.load()` is called anywhere in the codebase, ensure both `coreURL` and `wasmURL` use `toBlobURL`. Never pass raw string paths for either.
