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

function formatCreditsBadgeLabel(
  role: "admin" | "user",
  currentCreditUsd: number,
  creditFloorUsd: number,
): string {
  if (role === "admin") {
    return "Credits N/A";
  }
  const availableCreditsUsd = Math.max(currentCreditUsd - creditFloorUsd, 0);
  return `Credits $${availableCreditsUsd.toFixed(2)}`;
}

export function AuthPanel({
  mode = "account",
  heading,
  subtitle,
  blendWithShell = false,
  compact = false,
}: {
  mode?: "login" | "account";
  heading?: string;
  subtitle?: string;
  blendWithShell?: boolean;
  compact?: boolean;
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

    return (
      <AccountCard $blend={blendWithShell}>
        <AccountTopRow>
          <AccountIdentityBlock>
            {!compact || heading ? <AccountHeading>{heading ?? "Signed in"}</AccountHeading> : null}
            <AccountName>{displayName}</AccountName>
            <AccountSubline>{identityLine}</AccountSubline>
          </AccountIdentityBlock>
        </AccountTopRow>
        <AccountMetaGroup>
          <AccountBadge $tone="accent">Balance ${user.current_credit_usd.toFixed(2)}</AccountBadge>
          <AccountBadge>
            {formatCreditsBadgeLabel(
              user.role,
              user.current_credit_usd,
              user.credit_floor_usd,
            )}
          </AccountBadge>
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
    <AccountCard $blend={blendWithShell}>
      <AccountHeading>{heading ?? "Clerk session"}</AccountHeading>
      <MetaText>{subtitle ?? "Sign in happens on the dedicated Clerk route before the app shell opens."}</MetaText>
    </AccountCard>
  );
}
