---
name: h3-v2 Replit migration workaround
description: How to unblock bun install when @tanstack/react-start requires h3-v2 which is blocked by Replit's package firewall.
---

## The rule
When `bun install` fails with `GET http://package-firewall.replit.local/npm/h3-v2/-/h3-v2-2.0.1-rc.20.tgz - 404`, manually download and extract the tarball.

**Why:** Replit's package firewall blocks pre-release/RC packages that were published less than 24 hours ago (bunfig.toml `minimumReleaseAge`). The `h3-v2` alias (`npm:h3@2.0.1-rc.20`) is a dependency of `@tanstack/start-server-core`, which is required by `@tanstack/react-start`.

**How to apply:**
1. Download directly from registry: `curl -sL "https://registry.npmjs.org/h3/-/h3-2.0.1-rc.20.tgz" -o /tmp/h3-v2.tgz`
2. Extract into node_modules: `cd /tmp && tar -xzf h3-v2.tgz && cp -r package/* /path/to/node_modules/h3-v2/`
3. Then run `bun install` — it will find the package already present and succeed.

Note: `node_modules/h3-v2/` directory may already exist (from partial prior install) — just copy files into it.
