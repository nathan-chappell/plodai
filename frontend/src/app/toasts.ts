export type AppToast = {
  id: string;
  title: string;
  message: string;
  tone?: "info" | "warning" | "error";
};

type ToastListener = (toast: AppToast) => void;

const listeners = new Set<ToastListener>();
let lastPaymentRequiredToastAt = 0;

export function subscribeToToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishToast(toast: Omit<AppToast, "id">): void {
  const nextToast: AppToast = {
    id: crypto.randomUUID(),
    ...toast,
  };
  for (const listener of listeners) {
    listener(nextToast);
  }
}

export function publishPaymentRequiredToast(message?: string): void {
  const now = Date.now();
  if (now - lastPaymentRequiredToastAt < 3000) {
    return;
  }
  lastPaymentRequiredToastAt = now;
  publishToast({
    title: "No credit remaining",
    message: message ?? "Add credit to keep using the workspace.",
    tone: "warning",
  });
}
