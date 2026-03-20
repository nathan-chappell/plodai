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

export type ToolProviderClientTool<Args = Record<string, unknown>, Result = Record<string, unknown>> =
  FunctionToolDefinition & {
    handler: ClientToolHandler<Args, Result>;
  };

export type ToolProviderDelegationTarget = {
  tool_provider_id: string;
  tool_name: string;
  description: string;
};

export type ToolProviderSpec = {
  tool_provider_id: string;
  agent_name: string;
  instructions: string;
  client_tools: FunctionToolDefinition[];
  delegation_targets: ToolProviderDelegationTarget[];
};

export type ToolProviderBundle = {
  root_tool_provider_id: string;
  tool_providers: ToolProviderSpec[];
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

export type ToolProviderDefinition = {
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

export type WorkspaceSurfaceRegistration = {
  toolProviderId?: string;
  capabilityId?: string;
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

export type ToolRuntimeContext = {
  toolProviderId?: string;
  toolProviderTitle?: string;
  capabilityId?: string;
  capabilityTitle?: string;
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

export type ToolProviderDemoScenario = {
  id: string;
  title: string;
  summary: string;
  initialPrompt: string;
  workspaceSeed: LocalWorkspaceFile[];
  model?: string;
  expectedOutcomes?: string[];
  notes?: string[];
};

export type ToolProviderModule = {
  definition: ToolProviderDefinition;
  buildAgentSpec: (
    workspace: ToolRuntimeContext,
  ) => ToolProviderSpec;
  buildDemoScenario: () => ToolProviderDemoScenario | Promise<ToolProviderDemoScenario>;
  bindClientTools: (
    workspace: ToolRuntimeContext,
  ) => ToolProviderClientTool[] | Promise<ToolProviderClientTool[]>;
  Page: ComponentType<{
    onRegisterWorkspace?: (registration: WorkspaceSurfaceRegistration | null) => void;
  }>;
};

export type ToolProviderRuntimeModule = Pick<
  ToolProviderModule,
  "definition" | "buildAgentSpec" | "bindClientTools"
>;

export type CapabilityClientTool<Args = Record<string, unknown>, Result = Record<string, unknown>> =
  ToolProviderClientTool<Args, Result>;
export type CapabilityHandoffTarget = ToolProviderDelegationTarget;
export type CapabilityAgentSpec = ToolProviderSpec;
export type CapabilityBundle = ToolProviderBundle;
export type CapabilityDefinition = ToolProviderDefinition;
export type ShellWorkspaceRegistration = WorkspaceSurfaceRegistration;
export type CapabilityWorkspaceContext = ToolRuntimeContext;
export type CapabilityDemoScenario = ToolProviderDemoScenario;
export type CapabilityModule = ToolProviderModule;
export type CapabilityRuntimeModule = ToolProviderRuntimeModule;
