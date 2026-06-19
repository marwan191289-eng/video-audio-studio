---
name: h3-v2 Replit migration workaround
description: How to unblock bun install when @tanstack/react-start requires h3-v2 which is blocked by Replit's package firewall.
---

## The rule
When `bun install` fails with `GET http://package-firewall.replit.local/npm/h3-v2/-/h3-v2-2.0.1-rc.20.tgz - 404`, manually download and extract the tarball from npmjs.org directly.

**Why:** Replit's package firewall blocks pre-release/RC packages. The `h3-v2` alias (`npm:h3@2.0.1-rc.20`) is a dependency of `@tanstack/start-server-core`, which is required by `@tanstack/react-start`. Without it, vite dev fails with `ResolveMessage {}`.

**How to apply:**
1. Download from npm registry: `curl -sL "https://registry.npmjs.org/h3/-/h3-2.0.1-rc.20.tgz" -o /tmp/h3-real.tgz`
2. Extract with strip: `mkdir -p node_modules/h3-v2 && tar -xzf /tmp/h3-real.tgz -C node_modules/h3-v2 --strip-components=1`
3. The app is now runnable with `bun run dev`

**Persistence:** A `postinstall` script in `package.json` calls `node scripts/setup-packages.mjs` which re-downloads and installs `h3-v2` automatically after each `bun install`.

**Also fixed in this project:**
- Vite dev plugin now handles `/api/enhance-async`, `/api/job/:id`, `/api/job-result/:id` (previously only `/api/upload-chunk` and `/api/enhance` were handled — these missing routes went to TanStack Start which had body size limits)
- `serve.mjs` production server now also handles all those async job API routes with Busboy (no body size limit)
- DB schema was pushed with `bunx drizzle-kit push`
- ffmpeg installed as system dependency via Nix
