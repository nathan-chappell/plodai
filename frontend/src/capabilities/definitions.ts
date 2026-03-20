import type { CapabilityDefinition } from "./types";

export const reportAgentCapability: CapabilityDefinition = {
  id: "report-agent",
  path: "/capabilities/report-agent",
  navLabel: "Report Agent",
  title: "Report Agent",
  eyebrow: "Capability",
  description: "Narrative report assembly with CSV, chart, and PDF handoffs.",
  chatkitLead: "Investigate files, coordinate specialists, and shape the report with the user.",
  chatkitPlaceholder: "Tell the report agent what you want investigated or what report you need, and it will take it from there",
  tabs: [
    { id: "report", label: "Report" },
    { id: "reports", label: "Reports" },
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
  chatkitLead: "Query CSV files, compare slices, and materialize reusable result artifacts.",
  chatkitPlaceholder: "Tell the CSV agent what you want inspected, compared, or turned into a reusable CSV or JSON result",
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
  chatkitLead: "Turn explicit CSV and JSON artifacts into the clearest chart for the question.",
  chatkitPlaceholder: "Tell the Chart agent what comparison or visual story you want the chart to land",
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
  chatkitLead: "Inspect PDFs, pull out the pages that matter, and package clean splits.",
  chatkitPlaceholder: "Tell the PDF agent what document question, page extraction, or split you want handled",
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
  chatkitLead: "Capture structured feedback about the active thread.",
  chatkitPlaceholder: "Ask the Feedback agent to record a precise issue, suggestion, or reaction",
  tabs: [{ id: "agent", label: "Agent" }],
};

export const adminUsersCapability: CapabilityDefinition = {
  id: "admin-users",
  path: "/capabilities/admin-users",
  navLabel: "Admin capabilities",
  title: "User Management",
  eyebrow: "Admin",
  description: "Manage activation and credits.",
  chatkitLead: "Manage access, activation, and credits.",
  chatkitPlaceholder: "Ask the admin workspace to review a user, credits, or activation state",
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
