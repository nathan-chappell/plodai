import { useState } from "react";

import {
  CapabilityHeroRow,
  CapabilityHeader,
  CapabilityMetaText,
  CapabilityPanel,
  CapabilitySectionHeader,
  CapabilitySectionTitle,
  CapabilitySubhead,
  CapabilityTabBar,
  CapabilityTabButton,
  CapabilityTitle,
  CapabilityEyebrow,
} from "./styles";
import type { CapabilityDefinition } from "./types";
import { AdminCreditsPanel } from "../components/AdminCreditsPanel";
import { AuthPanel } from "../components/AuthPanel";

type AdminUsersTab = "users";

export const adminUsersCapability: CapabilityDefinition = {
  id: "admin-users",
  path: "/capabilities/admin-users",
  navLabel: "Admin capabilities",
  title: "User Management",
  eyebrow: "Admin",
  description: "Manage activation and credits.",
  tabs: [{ id: "users", label: "Users", visible: ({ role }) => role === "admin" }],
};

export function AdminUsersPage() {
  const [activeTab, setActiveTab] = useState<AdminUsersTab>("users");

  return (
    <>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{adminUsersCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{adminUsersCapability.title}</CapabilityTitle>
          <CapabilitySubhead>Activate users, grant credits, and manage basic account access.</CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" />
      </CapabilityHeroRow>

      <CapabilityTabBar>
        <CapabilityTabButton $active={activeTab === "users"} onClick={() => setActiveTab("users")} type="button">
          Users
        </CapabilityTabButton>
      </CapabilityTabBar>

      {activeTab === "users" ? (
        <CapabilityPanel>
          <CapabilitySectionHeader>
            <CapabilitySectionTitle>User controls</CapabilitySectionTitle>
            <CapabilityMetaText>Use Clerk user ids to manage access and credits.</CapabilityMetaText>
          </CapabilitySectionHeader>
          <AdminCreditsPanel />
        </CapabilityPanel>
      ) : null}
    </>
  );
}
