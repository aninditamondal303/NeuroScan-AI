import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server forwards /api to the FastAPI backend, so the browser only
// ever talks to one origin. Change the target with NEUROSCAN_API_URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.NEUROSCAN_API_URL ?? "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
  preview: { port: 5173 },
});
