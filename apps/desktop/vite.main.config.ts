import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __AIHUB_UPDATE_URL__: JSON.stringify(
      process.env.AIHUB_UPDATE_URL ?? "",
    ),
  },
  build: {
    rollupOptions: {
      external: ["node:sqlite"],
    },
  },
});
