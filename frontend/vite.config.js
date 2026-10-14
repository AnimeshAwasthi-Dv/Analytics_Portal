import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const apiTarget = loadEnv(mode, frontendRoot, "VITE_").VITE_API_BASE_URL;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      warmup: {
        clientFiles: [
          "src/main.tsx",
          "src/App.tsx",
          "src/pages/LoginPage.tsx",
          "src/pages/DashboardPage.tsx",
        ],
      },
      ...(apiTarget && {
        proxy: {
          "/auth": { target: apiTarget, changeOrigin: true },
          "/api": { target: apiTarget, changeOrigin: true },
        },
      }),
      watch: {
        usePolling: true,
      },
    },
  };
});