import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/viem/") || id.includes("/node_modules/ox/")) return "chain-runtime";
        },
      },
    },
  },
});
