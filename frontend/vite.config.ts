import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // @ts-ignore
  root: __dirname,
  envDir: '..',
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: process.env.VITE_BUILD_SOURCEMAP !== "false",
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: {
      allow: [".."],
    },
  },
});
