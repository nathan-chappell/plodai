import type { ComponentType } from "react";
import type { ClientEffect } from "../types/analysis";
import type { JsonSchema } from "../types/json-schema";
import type { LocalWorkspaceFile } from "../types/report";
import type { WorkspaceArtifactBucket } from "../types/workspace-contract";
import type {
  WorkspaceContext,
  WorkspaceDescriptor,
  WorkspaceFilesystem,
  WorkspaceKind,
  WorkspaceItem,
} from "../types/workspace";

export type FunctionToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
  strict?: boolean;
  display?: ToolDisplaySpec;
};

export type ToolDisplaySpec = {
  label?: string;
  prominent_args?: string[];
  omit_args?: string[];
  arg_labels?: Record<string, string>;
};

export type ComposerToolIcon =
  | "cube"
  | "analytics"
  | "chart"
  | "document";

export type ClientToolHandlerContext = {
  emitEffect: (effect: ClientEffect) => void;
  emitEffects: (effects: ClientEffect[]) => void;
  appendFiles: (files: LocalWorkspaceFile[]) => LocalWorkspaceFile[];
};

export type ClientToolHandler<Args = Record<string, unknown>, Result = Record<string, unknown>> = (
  args: Args,
  context: ClientToolHandlerContext,
) => Promise<Result>;

export type CapabilityClientTool<Args = Record<string, unknown>, Result = Record<string, unknown>> =
  FunctionToolDefinition & {
    handler: ClientToolHandler<Args, Result>;
  };

export type CapabilityHandoffTarget = {
  capability_id: string;
  tool_name: string;
  description: string;
};

export type CapabilityAgentSpec = {
  capability_id: string;
  agent_name: string;
  instructions: string;
  client_tools: FunctionToolDefinition[];
  handoff_targets: CapabilityHandoffTarget[];
};

export type CapabilityBundle = {
  root_capability_id: string;
  capabilities: CapabilityAgentSpec[];
};

export type CapabilityTab = {
  id: string;
  label: string;
  visible?: (params: { role: string }) => boolean;
};

export type PdfSmartSplitEntryView = {
  fileId: string;
  name: string;
  title: string;
  startPage: number;
  endPage: number;
  pageCount: number;
};

export type PdfSmartSplitBundleView = {
  id: string;
  createdAt: string;
  sourceFileId: string;
  sourceFileName: string;
  archiveFileId?: string;
  archiveFileName?: string;
  indexFileId?: string;
  indexFileName?: string;
  entries: PdfSmartSplitEntryView[];
};

export type CapabilityDefinition = {
  id: string;
  path: string;
  navLabel: string;
  title: string;
  eyebrow: string;
  description: string;
  chatkitLead: string;
  chatkitPlaceholder: string;
  tabs: CapabilityTab[];
  showInSidebar?: boolean;
  showInComposer?: boolean;
  composerOrder?: number;
  composerLabel?: string;
  composerShortLabel?: string;
  composerIcon?: ComposerToolIcon;
  composerPlaceholder?: string;
  previewPriority?: number;
};

export type ShellWorkspaceRegistration = {
  capabilityId: string;
  title: string;
  description: string;
  artifacts: ShellWorkspaceArtifact[];
  smartSplitBundles?: PdfSmartSplitBundleView[];
  workspaces: WorkspaceDescriptor[];
  activeWorkspaceId: string;
  activeWorkspaceName: string;
  activeWorkspaceKind: WorkspaceKind;
  accept?: string;
  onSelectFiles: (files: FileList | null) => Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string) => WorkspaceDescriptor | null;
  onClearWorkspace: () => void;
  clearActionLabel: string;
  clearActionDisabled?: boolean;
  onRemoveArtifact?: (entryId: string) => void;
};

export type ShellWorkspaceArtifact = {
  entryId: string;
  createdAt: string;
  bucket: WorkspaceArtifactBucket;
  source: "uploaded" | "derived" | "demo";
  producerKey: string;
  producerLabel: string;
  file: LocalWorkspaceFile;
};

export type CapabilityWorkspaceContext = {
  capabilityId: string;
  capabilityTitle: string;
  workspaceId: string;
  files: LocalWorkspaceFile[];
  entries: WorkspaceItem[];
  workspaceContext: WorkspaceContext;
  updateFilesystem: (
    updater: (filesystem: WorkspaceFilesystem) => WorkspaceFilesystem,
  ) => void;
  getState: () => {
    workspaceId: string;
    files: LocalWorkspaceFile[];
    entries: WorkspaceItem[];
    filesystem: WorkspaceFilesystem;
    workspaceContext: WorkspaceContext;
  };
};

export type CapabilityDemoScenario = {
  id: string;
  title: string;
  summary: string;
  initialPrompt: string;
  workspaceSeed: LocalWorkspaceFile[];
  model?: string;
  expectedOutcomes?: string[];
  notes?: string[];
};

export type CapabilityModule = {
  definition: CapabilityDefinition;
  buildAgentSpec: (
    workspace: CapabilityWorkspaceContext,
  ) => CapabilityAgentSpec;
  buildDemoScenario: () => CapabilityDemoScenario | Promise<CapabilityDemoScenario>;
  bindClientTools: (
    workspace: CapabilityWorkspaceContext,
  ) => CapabilityClientTool[] | Promise<CapabilityClientTool[]>;
  Page: ComponentType<{
    onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
  }>;
};

export type CapabilityRuntimeModule = Pick<
  CapabilityModule,
  "definition" | "buildAgentSpec" | "bindClientTools"
>;
