import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// I utvikling går alt gjennom Vite på samme opphav, så sesjonscookien
// oppfører seg som i produksjon uten ekstra oppsett.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: process.env.API_URL || "http://localhost:3000", changeOrigin: true },
    },
  },
});
