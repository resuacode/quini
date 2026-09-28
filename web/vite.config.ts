import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base relativa: funciona en GitHub Pages (https://usuario.github.io/quini/)
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1000 },
});
