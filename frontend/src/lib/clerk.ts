import { Clerk } from "@clerk/clerk-js";

import { CLERK_PUBLISHABLE_KEY, DEFAULT_AUTHENTICATED_PATH, SIGN_IN_PATH, isClerkEnabled } from "./auth";

let clerkPromise: Promise<Clerk | null> | null = null;

export async function getClerk(): Promise<Clerk | null> {
  if (!isClerkEnabled()) {
    return null;
  }
  if (!clerkPromise) {
    clerkPromise = (async () => {
      const clerk = new Clerk(CLERK_PUBLISHABLE_KEY);
      await clerk.load({
        signInUrl: SIGN_IN_PATH,
        signUpUrl: SIGN_IN_PATH,
      });
      return clerk;
    })();
  }
  return clerkPromise;
}

export async function getClerkToken(): Promise<string | null> {
  const clerk = await getClerk();
  if (!clerk?.session) {
    return null;
  }
  return (await clerk.session.getToken()) ?? null;
}

export async function signOutClerk(): Promise<void> {
  const clerk = await getClerk();
  if (!clerk?.session) {
    return;
  }
  await clerk.signOut();
}

export async function mountClerkSignIn(node: HTMLDivElement): Promise<() => void> {
  const clerk = await getClerk();
  if (!clerk) {
    return () => undefined;
  }
  clerk.mountSignIn(node, {
    signUpUrl: SIGN_IN_PATH,
    fallbackRedirectUrl: DEFAULT_AUTHENTICATED_PATH,
    forceRedirectUrl: DEFAULT_AUTHENTICATED_PATH,
  });
  return () => {
    clerk.unmountSignIn(node);
  };
}

export async function subscribeToClerkAuth(
  listener: (clerk: Clerk | null) => void | Promise<void>,
): Promise<() => void> {
  const clerk = await getClerk();
  if (!clerk) {
    await listener(null);
    return () => undefined;
  }
  await listener(clerk);
  return clerk.addListener(() => {
    void listener(clerk);
  });
}
