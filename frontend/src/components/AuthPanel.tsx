import { Show, UserButton, useClerk } from "@clerk/react";

import { useAppState } from "../app/context";
import {
  AccountActions,
  AccountBadge,
  AccountButton,
  AccountCard,
  AccountHeading,
  AccountIdentityBlock,
  AccountMetaGroup,
  AccountName,
  AccountSubline,
  AccountTopRow,
} from "./styles";
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
    const identityLine = user.email ?? user.id;
    const accountCapabilitiesLabel = user.role === "admin" ? "Admin capabilities" : null;

    return (
      <AccountCard>
        <AccountTopRow>
          <AccountIdentityBlock>
            <AccountHeading>{heading ?? "Signed in"}</AccountHeading>
            <AccountName>{displayName}</AccountName>
            <AccountSubline>{identityLine}</AccountSubline>
          </AccountIdentityBlock>
        </AccountTopRow>
        <AccountMetaGroup>
          {accountCapabilitiesLabel ? <AccountBadge>{accountCapabilitiesLabel}</AccountBadge> : null}
          <AccountBadge $tone="accent">Credits ${user.current_credit_usd.toFixed(2)}</AccountBadge>
          {subtitle ? <AccountBadge>{subtitle}</AccountBadge> : null}
        </AccountMetaGroup>
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
