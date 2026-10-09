import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// In development the API runs on :4000 and is proxied, so the app and API share one origin
// (the httpOnly session cookie then works exactly as in production behind nginx).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: false } },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    // Emit fonts as files: nginx's CSP is `font-src 'self'`, which blocks inlined data: fonts.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router"],
          motion: ["motion"],
        },
      },
    },
  },
});
