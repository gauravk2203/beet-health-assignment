import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Browser calls /api/... on the Vite origin; Vite forwards so we skip CORS.
      "/api": "https://beet-health-backend.onrender.com/",
    },
  },
});
