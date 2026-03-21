import type { AgentDefinition } from "./types";

export const helpAgentDefinition: AgentDefinition = {
  id: "help-agent",
  path: "/workspace",
  navLabel: "Workspace",
  title: "Workspace",
  eyebrow: "Workspace",
  description:
    "Shared workspace shell for browsing artifacts, choosing the right agent flow, and launching guided demos.",
  chatkitLead:
    "Explain the workspace shell, recommend the right agent flow, and launch the most useful demo when the user wants a guided start.",
  chatkitPlaceholder: "Ask what this app can do, which agent to use, or start the report or document demo",
  tabs: [],
  showInSidebar: true,
  showInComposer: false,
  composerOrder: 0,
  composerLabel: "Workspace",
  composerShortLabel: "Workspace",
  composerIcon: "cube",
  composerPlaceholder: "Explain the app, route to the right agent, or launch a demo workspace.",
  previewPriority: 0,
};

export const reportAgentDefinition: AgentDefinition = {
  id: "report-agent",
  path: "/workspace/report",
  navLabel: "Report",
  title: "Report Agent",
  eyebrow: "Mode",
  description: "Narrative report assembly with saved slides and delegated analysis.",
  chatkitLead: "Investigate shared exports, coordinate specialists, and shape a compact report that stays useful.",
  chatkitPlaceholder: "Ask for a stakeholder-ready report, a short board update, or a saved slide backed by the exported evidence",
  tabs: [],
  showInSidebar: false,
  showInComposer: false,
  composerOrder: 10,
  composerLabel: "Report",
  composerShortLabel: "Report",
  composerIcon: "cube",
  composerPlaceholder: "Build a report, review saved slides, or turn the current exports into a concise narrative.",
  previewPriority: 10,
};

export const analysisAgentDefinition: AgentDefinition = {
  id: "analysis-agent",
  path: "/workspace/analysis",
  navLabel: "Analysis",
  title: "Analysis Agent",
  eyebrow: "Hidden",
  description: "Tabular inspection, grouped analysis, and derived dataset exports.",
  chatkitLead: "Inspect datasets, create reusable exports, and keep analysis grounded in the available data.",
  chatkitPlaceholder: "Ask for a grouped query, a derived dataset artifact, or a compact data summary",
  tabs: [],
  showInSidebar: false,
  showInComposer: false,
  composerOrder: 20,
  composerLabel: "Analysis",
  composerShortLabel: "Analysis",
  composerIcon: "analytics",
  composerPlaceholder: "Inspect datasets, run grouped analysis, or create a derived dataset export.",
  previewPriority: 20,
};

export const chartAgentDefinition: AgentDefinition = {
  id: "chart-agent",
  path: "/workspace/charts",
  navLabel: "Charts",
  title: "Chart Agent",
  eyebrow: "Hidden",
  description: "Client-rendered chart planning and rendering over explicit datasets.",
  chatkitLead: "Turn explicit datasets into clear, polished charts.",
  chatkitPlaceholder: "Ask for a chart once the underlying dataset exists",
  tabs: [],
  showInSidebar: false,
  showInComposer: false,
  composerOrder: 30,
  composerLabel: "Charts",
  composerShortLabel: "Charts",
  composerIcon: "chart",
  composerPlaceholder: "Turn the current dataset into a clear, polished chart.",
  previewPriority: 30,
};

export const documentAgentDefinition: AgentDefinition = {
  id: "document-agent",
  path: "/workspace/documents",
  navLabel: "Documents",
  title: "Document Agent",
  eyebrow: "Mode",
  description: "PDF inspection, extraction, and smart document splits.",
  chatkitLead: "Inspect PDFs, split documents cleanly, and package useful shared outputs.",
  chatkitPlaceholder: "Ask to inspect a PDF, extract a page range, or perform a smart split",
  tabs: [],
  showInSidebar: false,
  showInComposer: false,
  composerOrder: 40,
  composerLabel: "Documents",
  composerShortLabel: "Docs",
  composerIcon: "document",
  composerPlaceholder: "Inspect a PDF, extract pages, or create a smart document split.",
  previewPriority: 40,
};

export const agricultureAgentDefinition: AgentDefinition = {
  id: "agriculture-agent",
  path: "/workspace/agriculture",
  navLabel: "Agriculture",
  title: "Agriculture Agent",
  eyebrow: "Mode",
  description: "Inspect plant photos, check trusted extension sources, and draft practical next steps.",
  chatkitLead: "Inspect plant images first, state uncertainty clearly, and turn observations into practical agriculture guidance.",
  chatkitPlaceholder: "Ask the agriculture agent to inspect plant photos, summarize visible evidence, and create a concise report update",
  tabs: [],
  showInSidebar: false,
  showInComposer: false,
  composerOrder: 50,
  composerLabel: "Agriculture",
  composerShortLabel: "Agri",
  composerIcon: "cube",
  composerPlaceholder: "Inspect plant photos, summarize visible evidence, and suggest practical next steps.",
  previewPriority: 50,
};

export const feedbackAgentDefinition: AgentDefinition = {
  id: "feedback-agent",
  path: "/workspace/feedback",
  navLabel: "Feedback",
  title: "Feedback Agent",
  eyebrow: "Backend",
  description: "Structured feedback capture for the active thread.",
  chatkitLead: "Capture structured feedback about the active thread.",
  chatkitPlaceholder: "Ask the feedback flow to capture a precise reaction or suggestion",
  tabs: [],
  showInSidebar: false,
  showInComposer: false,
  previewPriority: 90,
};

export const adminDefinition: AgentDefinition = {
  id: "admin-users",
  path: "/admin",
  navLabel: "Admin",
  title: "User Management",
  eyebrow: "Admin",
  description: "Manage activation and credits.",
  chatkitLead: "Manage access, activation, and credits.",
  chatkitPlaceholder: "Ask the admin workspace to review a user, credits, or activation state",
  tabs: [{ id: "users", label: "Users", visible: ({ role }) => role === "admin" }],
  showInSidebar: true,
  showInComposer: false,
  previewPriority: 999,
};

export const runtimeAgentDefinitions: AgentDefinition[] = [
  helpAgentDefinition,
  reportAgentDefinition,
  analysisAgentDefinition,
  chartAgentDefinition,
  documentAgentDefinition,
  agricultureAgentDefinition,
  feedbackAgentDefinition,
];

export const surfaceDefinitions: AgentDefinition[] = [helpAgentDefinition];

export const allAgentDefinitions: AgentDefinition[] = [
  ...surfaceDefinitions,
  adminDefinition,
];

const agentDefinitionById = new Map(
  [...runtimeAgentDefinitions, adminDefinition].map((agent) => [agent.id, agent]),
);

export function getAgentDefinition(agentId: string): AgentDefinition | null {
  return agentDefinitionById.get(agentId) ?? null;
}
