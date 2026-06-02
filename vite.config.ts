import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "node:path";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: {
        "rpc-websockets": path.resolve(
          "./node_modules/rpc-websockets/dist/index.browser.mjs"
        ),
      },
    },
    plugins: [
      nodePolyfills({
        include: ["buffer", "crypto", "stream", "util", "events", "process"],
        globals: { Buffer: true, global: true, process: true },
        protocolImports: true,
      }),
    ],
  },
});
