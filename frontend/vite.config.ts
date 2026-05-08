import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8085";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5176,
    strictPort: true,
    proxy: {
      "/api": apiProxyTarget,
      "/health": apiProxyTarget
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": apiProxyTarget,
      "/health": apiProxyTarget
    }
  }
});
