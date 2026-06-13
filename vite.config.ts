import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    // ── Dev server ────────────────────────────────────────────────────────
    server: {
      port: 5000,
      host: "0.0.0.0",
      allowedHosts: true,
      headers: {
        // Required for SharedArrayBuffer (enables FFmpeg multi-threading)
        "Cross-Origin-Opener-Policy":   "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        // Cache static assets in dev
        "Cache-Control": "no-cache",
      },
    },

    // ── Build optimisations ───────────────────────────────────────────────
    build: {
      // Raise chunk-size warning threshold (wasm files are large by design)
      chunkSizeWarningLimit: 50_000,

      rollupOptions: {
        output: {
          // Split vendor code into separate cacheable chunks
          manualChunks(id) {
            if (id.includes("node_modules/@ffmpeg"))   return "ffmpeg";
            if (id.includes("node_modules/@radix-ui")) return "radix";
            if (id.includes("node_modules/lucide"))    return "icons";
            if (id.includes("node_modules/recharts"))  return "charts";
          },
        },
      },

      // Use esbuild for minification (faster, produces smaller output)
      minify: "esbuild",

      // Enable source maps only for debugging (disable in production for speed)
      sourcemap: false,

      // Inline assets smaller than 4 KB (reduces HTTP round-trips)
      assetsInlineLimit: 4096,
    },

    // ── Worker options ────────────────────────────────────────────────────
    worker: {
      format: "es",
    },

    // ── Optimise deps ─────────────────────────────────────────────────────
    optimizeDeps: {
      exclude: [
        // FFmpeg WASM must not be pre-bundled — it's a binary module
        "@ffmpeg/ffmpeg",
        "@ffmpeg/util",
        "@ffmpeg/core",
        "@ffmpeg/core-mt",
      ],
    },
  },
});
