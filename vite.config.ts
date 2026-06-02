import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: {
        buffer: "buffer/",
      },
    },
    optimizeDeps: {
      include: ["buffer", "eventemitter3"],
    },
  },
});
