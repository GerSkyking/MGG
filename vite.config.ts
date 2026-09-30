import { defineConfig } from "vite";

// /gitproxy/ leitet im Dev-Server (und Preview) an die eigene Gitea weiter, wie nginx im Container.
const gitProxy = {
  "/gitproxy": {
    target: "https://git.jensr.de",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/gitproxy/, ""),
  },
};

export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  server: { proxy: gitProxy },
  preview: { proxy: gitProxy },
});
