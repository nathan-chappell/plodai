import type { CapabilityDefinition } from "./types";

export const reportAgentCapability: CapabilityDefinition = {
  id: "report-agent",
  path: "/capabilities/report-agent",
  navLabel: "Report Agent",
  title: "Report Agent",
  eyebrow: "Capability",
  description: "Narrative report assembly with CSV, chart, and PDF handoffs.",
  tabs: [
    { id: "report", label: "Report" },
    { id: "demo", label: "Demo" },
  ],
};

export const csvAgentCapability: CapabilityDefinition = {
  id: "csv-agent",
  path: "/capabilities/csv-agent",
  navLabel: "CSV Agent",
  title: "CSV Agent",
  eyebrow: "Capability",
  description: "Structured CSV analysis and chartable artifact creation.",
  tabs: [
    { id: "agent", label: "Agent" },
    { id: "demo", label: "Demo" },
  ],
};

export const chartAgentCapability: CapabilityDefinition = {
  id: "chart-agent",
  path: "/capabilities/chart-agent",
  navLabel: "Chart Agent",
  title: "Chart Agent",
  eyebrow: "Capability",
  description: "Beautiful Chart.js rendering over explicit CSV and JSON artifacts.",
  tabs: [
    { id: "agent", label: "Agent" },
    { id: "demo", label: "Demo" },
  ],
};

export const pdfAgentCapability: CapabilityDefinition = {
  id: "pdf-agent",
  path: "/capabilities/pdf-agent",
  navLabel: "PDF Agent",
  title: "PDF Agent",
  eyebrow: "Capability",
  description: "Bounded PDF extraction and decomposition workspace.",
  tabs: [
    { id: "agent", label: "Agent" },
    { id: "demo", label: "Demo" },
  ],
};

export const feedbackAgentCapability: CapabilityDefinition = {
  id: "feedback-agent",
  path: "/capabilities/feedback-agent",
  navLabel: "Feedback Agent",
  title: "Feedback Agent",
  eyebrow: "Capability",
  description: "Structured feedback capture over the active client workspace thread.",
  tabs: [{ id: "agent", label: "Agent" }],
};

export const workspaceAgentCapability: CapabilityDefinition = {
  id: "workspace-agent",
  path: "/capabilities/workspace-agent",
  navLabel: "Workspace Agent",
  title: "Workspace Agent",
  eyebrow: "Capability",
  description: "Shared workspace navigation over the client-side filesystem.",
  tabs: [{ id: "agent", label: "Agent" }],
};

export const adminUsersCapability: CapabilityDefinition = {
  id: "admin-users",
  path: "/capabilities/admin-users",
  navLabel: "Admin capabilities",
  title: "User Management",
  eyebrow: "Admin",
  description: "Manage activation and credits.",
  tabs: [{ id: "users", label: "Users", visible: ({ role }) => role === "admin" }],
};

export const capabilityDefinitions: CapabilityDefinition[] = [
  reportAgentCapability,
  csvAgentCapability,
  chartAgentCapability,
  pdfAgentCapability,
];

export const allCapabilityDefinitions: CapabilityDefinition[] = [
  ...capabilityDefinitions,
  adminUsersCapability,
];
