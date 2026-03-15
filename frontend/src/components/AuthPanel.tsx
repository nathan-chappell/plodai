import { Show, UserButton, useClerk } from "@clerk/react";

import { useAppState } from "../app/context";
import { AccountActions, AccountButton, AccountCard, AccountHeading } from "./styles";
import { MetaText } from "../app/styles";

export function AuthPanel({
  mode = "account",
  heading,
  subtitle,
}: {
  mode?: "login" | "account";
  heading?: string;
  subtitle?: string;
}) {
  const { user, setUser } = useAppState();
  const { signOut } = useClerk();

  async function handleLogout() {
    await signOut();
    setUser(null);
  }

  if (mode === "account" && user) {
    const displayName = user.full_name || user.email || user.id;

    return (
      <AccountCard>
        <AccountHeading>{heading ?? "Signed in"}</AccountHeading>
        {subtitle ? <MetaText>{subtitle}</MetaText> : null}
        <strong>{displayName}</strong>
        <MetaText as="div">
          {(user.email ?? user.id)} | {user.role}
        </MetaText>
        <AccountActions>
          <Show when="signed-in">
            <UserButton />
          </Show>
          <AccountButton onClick={() => void handleLogout()} type="button">
            Sign out
          </AccountButton>
        </AccountActions>
      </AccountCard>
    );
  }

  return (
    <AccountCard>
      <AccountHeading>{heading ?? "Clerk session"}</AccountHeading>
      <MetaText>{subtitle ?? "Sign in happens on the dedicated Clerk route before the app shell opens."}</MetaText>
    </AccountCard>
  );
}
