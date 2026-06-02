import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";

const bufferShim = path.resolve("./node_modules/buffer/index.js");
const cryptoShim = path.resolve("./node_modules/crypto-browserify/index.js");

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: [
        { find: /^node:buffer$/, replacement: bufferShim },
        { find: /^buffer$/, replacement: bufferShim },
        { find: /^node:crypto$/, replacement: cryptoShim },
      ],
    },
    optimizeDeps: {
      include: ["buffer", "eventemitter3"],
    },
  },
});
