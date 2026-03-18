/// <reference types="vite/client" />

declare module "pdfjs-dist/legacy/build/pdf.mjs";

declare global {
  interface Window {
    __fireTestHarness?: {
      reset: () => void;
      getSnapshot: () => unknown;
    };
  }
}
