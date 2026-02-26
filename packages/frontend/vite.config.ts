import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// ============================================================
// Vite Multi-Page Application
// 各画面が独立した HTML エントリーポイントを持つ MPA 構成
// ============================================================

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    rollupOptions: {
      input: {
        // サーバーのパスに対応させる
        index:      path.resolve(__dirname, "index.html"),
        display:    path.resolve(__dirname, "display.html"),
        controller: path.resolve(__dirname, "controller.html"),
        guest:      path.resolve(__dirname, "guest.html"),
        manage:     path.resolve(__dirname, "manage.html"),
      },
    },
    // ビルド成果物をサーバーの public/app/ に出力する
    outDir: path.resolve(__dirname, "../../packages/server/public/app"),
    emptyOutDir: true,
  },

  // 開発時もサーバー(3000)へのAPI/WS通信をプロキシ
  server: {
    port: 5173,
    proxy: {
      "/api":    { target: "http://localhost:3000", changeOrigin: true },
      "/images": { target: "http://localhost:3000", changeOrigin: true },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
