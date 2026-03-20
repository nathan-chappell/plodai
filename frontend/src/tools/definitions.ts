import type { ToolProviderDefinition } from "./types";

export const workspaceAgentToolProvider: ToolProviderDefinition = {
  id: "workspace-agent",
  path: "/workspace",
  navLabel: "Workspace",
  title: "Workspace",
  eyebrow: "Workspace",
  description: "One shared chat-led workspace for files, tools, previews, and compact reporting.",
  chatkitLead: "Investigate local files, use the right tool, and keep the latest useful output in view.",
  chatkitPlaceholder: "Ask the workspace to inspect files, create artifacts, render charts, split PDFs, or update the report",
  tabs: [],
  showInSidebar: true,
  showInComposer: false,
  composerOrder: 0,
  composerLabel: "Workspace",
  composerShortLabel: "Workspace",
  composerIcon: "cube",
  composerPlaceholder: "Route work through the shared workspace and the right specialist.",
  previewPriority: 0,
};

export const reportAgentToolProvider: ToolProviderDefinition = {
  id: "report-agent",
  path: "/capabilities/report-agent",
  navLabel: "Report Agent",
  title: "Report Agent",
  eyebrow: "Tool",
  description: "Narrative report assembly with data and PDF handoffs.",
  chatkitLead: "Investigate files, coordinate specialists, and shape the report with the user.",
  chatkitPlaceholder: "Tell the report agent what you want investigated or what report you need, and it will take it from there",
  tabs: [
    { id: "report", label: "Report" },
    { id: "reports", label: "Reports" },
    { id: "demo", label: "Demo" },
  ],
  showInSidebar: false,
  showInComposer: true,
  composerOrder: 10,
  composerLabel: "Report",
  composerShortLabel: "Report",
  composerIcon: "document",
  composerPlaceholder: "Use the report specialist for narrative investigations and saved slides.",
  previewPriority: 10,
};

export const dataAgentToolProvider: ToolProviderDefinition = {
  id: "data-agent",
  path: "/capabilities/data-agent",
  navLabel: "Data Agent",
  title: "Data Agent",
  eyebrow: "Tool",
  description: "Composed data investigation over CSV analysis and chart follow-through.",
  chatkitLead: "Investigate data files, create reusable artifacts, and drive chart follow-through when the story should be visualized.",
  chatkitPlaceholder: "Tell the data tool what comparison, summary, artifact, or chart outcome you want from the available data files",
  tabs: [{ id: "demo", label: "Demo" }],
  showInSidebar: false,
  showInComposer: true,
  composerOrder: 20,
  composerLabel: "Data",
  composerShortLabel: "Data",
  composerIcon: "analytics",
  composerPlaceholder: "Use the data tool for grouped analysis, reusable artifacts, and chart follow-through.",
  previewPriority: 20,
};

export const csvAgentToolProvider: ToolProviderDefinition = {
  id: "csv-agent",
  path: "/capabilities/csv-agent",
  navLabel: "CSV Agent",
  title: "CSV Agent",
  eyebrow: "Tool",
  description: "Structured CSV analysis and artifact creation.",
  chatkitLead: "Inspect CSV files, run safe grouped queries, and materialize reusable result artifacts.",
  chatkitPlaceholder: "Tell the CSV agent what you want inspected, compared, or turned into a reusable CSV or JSON result",
  tabs: [
    { id: "agent", label: "Agent" },
    { id: "demo", label: "Demo" },
  ],
  showInSidebar: false,
  showInComposer: false,
  composerOrder: 30,
  composerLabel: "CSV",
  composerShortLabel: "CSV",
  composerIcon: "analytics",
  composerPlaceholder: "Use the CSV specialist for grouped queries and reusable data artifacts.",
  previewPriority: 30,
};

export const chartAgentToolProvider: ToolProviderDefinition = {
  id: "chart-agent",
  path: "/capabilities/chart-agent",
  navLabel: "Chart Agent",
  title: "Chart Agent",
  eyebrow: "Tool",
  description: "Beautiful Chart.js rendering over explicit CSV and JSON artifacts.",
  chatkitLead: "Turn explicit CSV and JSON artifacts into the clearest chart for the question.",
  chatkitPlaceholder: "Tell the Chart agent what comparison or visual story you want the chart to land",
  tabs: [
    { id: "agent", label: "Agent" },
    { id: "demo", label: "Demo" },
  ],
  showInSidebar: false,
  showInComposer: false,
  composerOrder: 40,
  composerLabel: "Charts",
  composerShortLabel: "Charts",
  composerIcon: "chart",
  composerPlaceholder: "Use the chart specialist to turn saved data artifacts into polished charts.",
  previewPriority: 40,
};

export const pdfAgentToolProvider: ToolProviderDefinition = {
  id: "pdf-agent",
  path: "/capabilities/pdf-agent",
  navLabel: "PDF Agent",
  title: "PDF Agent",
  eyebrow: "Tool",
  description: "Bounded PDF extraction and decomposition workspace.",
  chatkitLead: "Inspect PDFs, pull out the pages that matter, and package clean splits.",
  chatkitPlaceholder: "Tell the PDF agent what document question, page extraction, or split you want handled",
  tabs: [
    { id: "agent", label: "Agent" },
    { id: "demo", label: "Demo" },
  ],
  showInSidebar: false,
  showInComposer: true,
  composerOrder: 40,
  composerLabel: "PDF",
  composerShortLabel: "PDF",
  composerIcon: "document",
  composerPlaceholder: "Use the PDF specialist for inspection, extraction, and smart splits.",
  previewPriority: 40,
};

export const feedbackAgentToolProvider: ToolProviderDefinition = {
  id: "feedback-agent",
  path: "/capabilities/feedback-agent",
  navLabel: "Feedback Agent",
  title: "Feedback Agent",
  eyebrow: "Backend",
  description: "Structured feedback capture over the active client workspace thread.",
  chatkitLead: "Capture structured feedback about the active thread.",
  chatkitPlaceholder: "Ask the Feedback agent to record a precise issue, suggestion, or reaction",
  tabs: [{ id: "agent", label: "Agent" }],
  showInSidebar: false,
  showInComposer: false,
  composerOrder: 90,
  composerLabel: "Feedback",
  composerShortLabel: "Feedback",
  composerIcon: "cube",
  composerPlaceholder: "Capture structured feedback about the current thread.",
  previewPriority: 90,
};

export const adminUsersSurface: ToolProviderDefinition = {
  id: "admin-users",
  path: "/capabilities/admin-users",
  navLabel: "Admin tools",
  title: "User Management",
  eyebrow: "Admin",
  description: "Manage activation and credits.",
  chatkitLead: "Manage access, activation, and credits.",
  chatkitPlaceholder: "Ask the admin workspace to review a user, credits, or activation state",
  tabs: [{ id: "users", label: "Users", visible: ({ role }) => role === "admin" }],
  showInSidebar: true,
  showInComposer: false,
  composerOrder: 999,
  composerLabel: "Admin",
  composerShortLabel: "Admin",
  composerIcon: "cube",
  composerPlaceholder: "Review user access, activation, and credits.",
  previewPriority: 999,
};

export const runtimeToolProviderDefinitions: ToolProviderDefinition[] = [
  workspaceAgentToolProvider,
  reportAgentToolProvider,
  dataAgentToolProvider,
  csvAgentToolProvider,
  chartAgentToolProvider,
  pdfAgentToolProvider,
  feedbackAgentToolProvider,
];

export const surfaceDefinitions: ToolProviderDefinition[] = [
  workspaceAgentToolProvider,
];

export const allToolSurfaceDefinitions: ToolProviderDefinition[] = [
  ...surfaceDefinitions,
  adminUsersSurface,
];

const toolProviderDefinitionById = new Map(
  [...runtimeToolProviderDefinitions, adminUsersSurface].map((toolProvider) => [
    toolProvider.id,
    toolProvider,
  ]),
);

export function getToolProviderDefinition(toolProviderId: string): ToolProviderDefinition | null {
  return toolProviderDefinitionById.get(toolProviderId) ?? null;
}

export const workspaceAgentCapability = workspaceAgentToolProvider;
export const reportAgentCapability = reportAgentToolProvider;
export const dataAgentCapability = dataAgentToolProvider;
export const csvAgentCapability = csvAgentToolProvider;
export const chartAgentCapability = chartAgentToolProvider;
export const pdfAgentCapability = pdfAgentToolProvider;
export const feedbackAgentCapability = feedbackAgentToolProvider;
export const adminUsersCapability = adminUsersSurface;
export const runtimeCapabilityDefinitions = runtimeToolProviderDefinitions;
export const capabilityDefinitions = surfaceDefinitions;
export const allCapabilityDefinitions = allToolSurfaceDefinitions;
export const getCapabilityDefinition = getToolProviderDefinition;
