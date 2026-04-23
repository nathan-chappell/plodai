export const SIGN_IN_PATH = "/sign-in";
export const DEFAULT_AUTHENTICATED_PATH = "/plodai";
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
  throw new Error(
    "Missing required VITE_CLERK_PUBLISHABLE_KEY. Set it before starting the Vite dev server or building the frontend bundle.",
  );
}

export const CLERK_PUBLISHABLE_KEY = clerkPublishableKey;
