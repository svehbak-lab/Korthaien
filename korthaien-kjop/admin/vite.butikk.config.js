import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { renameSync } from "node:fs";

// Den offentlige butikken. Bygges fra de samme filene som admin, men med
// sin egen inngang og til sin egen mappe, så den kan ligge på korthaien.no
// uten at admin følger med.
export default defineConfig({
  plugins: [
    react(),
    {
      name: "butikk-som-index",
      closeBundle() {
        try { renameSync("dist-butikk/butikk.html", "dist-butikk/index.html"); } catch {}
      },
    },
  ],
  build: {
    outDir: "dist-butikk",
    emptyOutDir: true,
    rollupOptions: { input: "butikk.html" },
  },
  server: {
    open: "/butikk.html",
    proxy: {
      "/api": { target: process.env.API_URL || "http://localhost:3000", changeOrigin: true },
    },
  },
});
