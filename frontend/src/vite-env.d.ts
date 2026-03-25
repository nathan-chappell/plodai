/// <reference types="vite/client" />

declare global {
  interface Window {
    __fireTestHarness?: {
      reset: () => void;
      getSnapshot: () => unknown;
    };
  }
}
