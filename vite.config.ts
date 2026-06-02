import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: [
        { find: /^node:buffer$/, replacement: "buffer" },
        { find: /^node:crypto$/, replacement: "crypto-browserify" },
      ],
    },
    optimizeDeps: {
      include: ["buffer", "eventemitter3"],
    },
  },
});
