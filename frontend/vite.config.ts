import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function watchTimestampPlugin() {
  const watchEnabled = process.argv.includes("--watch");

  return {
    name: "watch-timestamp-logger",
    apply: "build" as const,
    buildStart() {
      if (!watchEnabled) {
        return;
      }
      console.info(`[build:watch ${formatTimestamp(new Date())}] rebuild started`);
    },
    closeBundle() {
      if (!watchEnabled) {
        return;
      }
      console.info(`[build:watch ${formatTimestamp(new Date())}] rebuild finished`);
    },
  };
}

function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) {
    return undefined;
  }
  if (id.includes("pdfjs-dist")) {
    return "vendor-pdfjs";
  }
  if (id.includes("pdf-lib") || id.includes("@pdf-lib") || id.includes("pako")) {
    return "vendor-pdf-lib";
  }
  if (id.includes("@openai/chatkit")) {
    return "vendor-chatkit";
  }
  if (id.includes("chart.js") || id.includes("react-chartjs-2")) {
    return "vendor-charts";
  }
  if (id.includes("react-markdown")) {
    return "vendor-markdown";
  }
  if (id.includes("@clerk")) {
    return "vendor-clerk";
  }
  if (id.includes("styled-components") || id.includes("stylis") || id.includes("@emotion")) {
    return "vendor-styling";
  }
  if (id.includes("react-dom") || id.includes("scheduler") || id.includes("/react/")) {
    return "vendor-react";
  }
  return "vendor-misc";
}

export default defineConfig({
  // @ts-ignore
  root: __dirname,
  envDir: '..',
  plugins: [react(), watchTimestampPlugin()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: process.env.VITE_BUILD_SOURCEMAP !== "false",
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  worker: {
    format: "es",
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: {
      allow: [".."],
    },
  },
});
