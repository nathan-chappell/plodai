import type { AgentDefinition } from "./types";

const COMMON_WORKSPACE_ATTACHMENTS = {
  "text/csv": [".csv"],
  "application/json": [".json"],
  "text/plain": [".txt", ".md"],
  "application/pdf": [".pdf"],
  "application/zip": [".zip"],
  "image/*": [".png", ".jpg", ".jpeg", ".webp"],
} as const;

const TABULAR_ATTACHMENTS = {
  "text/csv": [".csv"],
  "application/json": [".json"],
} as const;

const PDF_ATTACHMENTS = {
  "application/pdf": [".pdf"],
} as const;

const DOCUMENT_THREAD_ATTACHMENTS = {
  "application/pdf": [".pdf"],
  "text/csv": [".csv"],
  "application/json": [".json"],
} as const;

const IMAGE_ATTACHMENTS = {
  "image/*": [".png", ".jpg", ".jpeg", ".webp"],
} as const;

export const reportAgentDefinition: AgentDefinition = {
  id: "report-agent",
  path: "/workspace/report",
  navLabel: "Report",
  title: "Report",
  eyebrow: "Mode",
  description: "Narrative report assembly with saved slides and delegated analysis.",
  chatkitLead: "Use Report when you want a concise write-up, saved slides, or a stakeholder-ready summary.",
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
  attachmentConfig: {
    enabled: true,
    accept: COMMON_WORKSPACE_ATTACHMENTS,
    maxCount: 10,
    maxSize: 100 * 1024 * 1024,
  },
};

export const analysisAgentDefinition: AgentDefinition = {
  id: "analysis-agent",
  path: "/workspace/analysis",
  navLabel: "Analysis",
  title: "Analysis",
  eyebrow: "Hidden",
  description: "Tabular inspection, grouped analysis, and derived dataset exports.",
  chatkitLead: "Use Analysis to inspect datasets, compare segments, and create reusable derived tables.",
  chatkitPlaceholder: "Ask for a grouped query, a derived dataset export, or a compact data summary",
  tabs: [],
  showInSidebar: false,
  showInComposer: false,
  composerOrder: 20,
  composerLabel: "Analysis",
  composerShortLabel: "Analysis",
  composerIcon: "analytics",
  composerPlaceholder: "Inspect datasets, run grouped analysis, or create a derived dataset export.",
  previewPriority: 20,
  attachmentConfig: {
    enabled: true,
    accept: TABULAR_ATTACHMENTS,
    maxCount: 10,
    maxSize: 100 * 1024 * 1024,
  },
};

export const chartAgentDefinition: AgentDefinition = {
  id: "chart-agent",
  path: "/workspace/charts",
  navLabel: "Charts",
  title: "Charts",
  eyebrow: "Hidden",
  description: "Client-rendered chart planning and rendering over explicit datasets.",
  chatkitLead: "Use Charts when you already have a dataset and want a clear, polished visual.",
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
  attachmentConfig: {
    enabled: true,
    accept: TABULAR_ATTACHMENTS,
    maxCount: 10,
    maxSize: 100 * 1024 * 1024,
  },
};

export const documentAgentDefinition: AgentDefinition = {
  id: "document-agent",
  path: "/documents",
  navLabel: "Documents",
  title: "Documents",
  eyebrow: "App",
  description: "PDF inspection, extraction, and smart document splits.",
  chatkitLead: "Use Documents to inspect PDFs, extract pages, or split a packet into useful sections.",
  chatkitPlaceholder: "Ask to inspect a PDF, extract a page range, or perform a smart split",
  tabs: [],
  showInSidebar: true,
  showInComposer: false,
  composerOrder: 40,
  composerLabel: "Documents",
  composerShortLabel: "Docs",
  composerIcon: "document",
  composerPlaceholder: "Inspect a PDF, extract pages, or create a smart document split.",
  previewPriority: 40,
  attachmentConfig: {
    enabled: true,
    accept: DOCUMENT_THREAD_ATTACHMENTS,
    maxCount: 10,
    maxSize: 100 * 1024 * 1024,
  },
};

export const agricultureAgentDefinition: AgentDefinition = {
  id: "agriculture-agent",
  path: "/agriculture",
  navLabel: "Agriculture",
  title: "Agriculture",
  eyebrow: "App",
  description: "Inspect plant photos, check trusted extension sources, and draft practical next steps.",
  chatkitLead: "Use Agriculture to inspect plant photos and turn visible evidence into practical next steps.",
  chatkitPlaceholder: "Ask the agriculture agent to inspect plant photos, summarize visible evidence, and create a concise report update",
  tabs: [],
  showInSidebar: true,
  showInComposer: false,
  composerOrder: 50,
  composerLabel: "Agriculture",
  composerShortLabel: "Agri",
  composerIcon: "cube",
  composerPlaceholder: "Inspect plant photos, summarize visible evidence, and suggest practical next steps.",
  previewPriority: 50,
  attachmentConfig: {
    enabled: true,
    accept: IMAGE_ATTACHMENTS,
    maxCount: 10,
    maxSize: 10 * 1024 * 1024,
  },
};

export const feedbackAgentDefinition: AgentDefinition = {
  id: "feedback-agent",
  path: "/workspace/feedback",
  navLabel: "Feedback",
  title: "Feedback",
  eyebrow: "Backend",
  description: "Structured feedback capture for the active chat.",
  chatkitLead: "Use Feedback to leave a clear reaction or suggestion about this chat.",
  chatkitPlaceholder: "Ask the feedback flow to capture a precise reaction or suggestion",
  tabs: [],
  showInSidebar: false,
  showInComposer: false,
  previewPriority: 90,
  attachmentConfig: {
    enabled: false,
  },
};

export const adminDefinition: AgentDefinition = {
  id: "admin-users",
  path: "/admin",
  navLabel: "Admin",
  title: "User Management",
  eyebrow: "Admin",
  description: "Manage activation and credits.",
  chatkitLead: "Use Admin to review access, activation, and credit status.",
  chatkitPlaceholder: "Ask the admin workspace to review a user, credits, or activation state",
  tabs: [{ id: "users", label: "Users", visible: ({ role }) => role === "admin" }],
  showInSidebar: true,
  showInComposer: false,
  previewPriority: 999,
  attachmentConfig: {
    enabled: false,
  },
};

export const runtimeAgentDefinitions: AgentDefinition[] = [
  reportAgentDefinition,
  analysisAgentDefinition,
  chartAgentDefinition,
  documentAgentDefinition,
  agricultureAgentDefinition,
  feedbackAgentDefinition,
];

export const surfaceDefinitions: AgentDefinition[] = [
  agricultureAgentDefinition,
  documentAgentDefinition,
];

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
