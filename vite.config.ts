import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
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
  },
});
