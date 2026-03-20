import { useEffect, useRef, useState } from "react";
import { Show, UserButton, useClerk } from "@clerk/react";

import { useAppState } from "../app/context";
import {
  AccountActions,
  AccountBadge,
  AccountButton,
  AccountCard,
  AccountHeading,
  AccountIconButton,
  AccountIdentityBlock,
  AccountMetaGroup,
  AccountName,
  AccountSubline,
  AccountThemeLabel,
  AccountThemeList,
  AccountThemeModeButton,
  AccountThemeModeToggle,
  AccountThemeOption,
  AccountThemePopover,
  AccountThemePopoverHeader,
  AccountThemePopoverTitle,
  AccountThemePreview,
  AccountThemeSwatch,
  AccountThemeWrap,
  AccountTopRow,
} from "./styles";
import { MetaText } from "../app/styles";
import { usePlatformTheme } from "./platformTheme";

function ThemeIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M10 3.5v2.2m0 8.6v2.2m6.5-6.5h-2.2M5.7 10H3.5m11.1 4.6-1.6-1.6M7 7 5.4 5.4m9.2 0L13 7M7 13l-1.6 1.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <circle cx="10" cy="10" r="3.1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

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
}: {
  mode?: "login" | "account";
  heading?: string;
  subtitle?: string;
}) {
  const { user, setUser } = useAppState();
  const { signOut } = useClerk();
  const { activeTheme, presets, themeId, setThemeId, themeMode, setThemeMode } = usePlatformTheme();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!themeMenuRef.current?.contains(event.target as Node)) {
        setThemeMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  async function handleLogout() {
    await signOut();
    setUser(null);
  }

  if (mode === "account" && user) {
    const displayName = user.full_name || user.email || user.id;
    const identityLine = user.email ?? user.id;

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
          <AccountThemeWrap ref={themeMenuRef}>
            <AccountIconButton
              aria-expanded={themeMenuOpen}
              aria-label="Theme settings"
              data-testid="account-theme-trigger"
              onClick={() => setThemeMenuOpen((current) => !current)}
              title={`Theme: ${activeTheme.label}`}
              type="button"
            >
              <ThemeIcon />
            </AccountIconButton>
            {themeMenuOpen ? (
              <AccountThemePopover data-testid="account-theme-popover">
                <AccountThemePopoverHeader>
                  <AccountThemePopoverTitle>Theme</AccountThemePopoverTitle>
                  <MetaText>Choose the workspace look and color scheme.</MetaText>
                </AccountThemePopoverHeader>
                <AccountThemeList>
                  {presets.map((preset) => (
                    <AccountThemeOption
                      key={preset.id}
                      $active={preset.id === themeId}
                      onClick={() => {
                        setThemeId(preset.id);
                        setThemeMenuOpen(false);
                      }}
                      type="button"
                    >
                      <AccountThemePreview>
                        <AccountThemeSwatch $color={preset.lightValues["--accent"]} />
                        <AccountThemeSwatch $color={preset.lightValues["--sidebar-bg"]} />
                        <AccountThemeSwatch $color={preset.lightValues["--bg-bottom"]} />
                      </AccountThemePreview>
                      <AccountThemeLabel>{preset.label}</AccountThemeLabel>
                    </AccountThemeOption>
                  ))}
                </AccountThemeList>
                <AccountThemeModeToggle>
                  <AccountThemeModeButton
                    $active={themeMode === "light"}
                    onClick={() => {
                      setThemeMode("light");
                      setThemeMenuOpen(false);
                    }}
                    type="button"
                  >
                    Light
                  </AccountThemeModeButton>
                  <AccountThemeModeButton
                    $active={themeMode === "dark"}
                    onClick={() => {
                      setThemeMode("dark");
                      setThemeMenuOpen(false);
                    }}
                    type="button"
                  >
                    Dark
                  </AccountThemeModeButton>
                </AccountThemeModeToggle>
              </AccountThemePopover>
            ) : null}
          </AccountThemeWrap>
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
