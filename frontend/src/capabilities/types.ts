import type { ComponentType } from "react";
import type { ClientEffect } from "../types/analysis";
import type { ExecutionMode } from "../types/analysis";
import type { JsonSchema } from "../types/json-schema";
import type { LocalWorkspaceFile } from "../types/report";
import type {
  WorkspaceBreadcrumb,
  WorkspaceContext,
  WorkspaceFilesystem,
  WorkspaceItem,
} from "../types/workspace";

export type FunctionToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
  strict?: boolean;
};

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

export type CapabilityDefinition = {
  id: string;
  path: string;
  navLabel: string;
  title: string;
  eyebrow: string;
  description: string;
  tabs: CapabilityTab[];
};

export type ShellWorkspaceRegistration = {
  capabilityId: string;
  title: string;
  description: string;
  activePrefix: string;
  cwdPath: string;
  filesystem: WorkspaceFilesystem;
  breadcrumbs: WorkspaceBreadcrumb[];
  entries: WorkspaceItem[];
  accept?: string;
  onSelectFiles: (files: FileList | null) => Promise<void>;
  onCreateDirectory: (path: string) => void;
  onChangeDirectory: (path: string) => void;
  onRemoveEntry?: (entryId: string) => void;
};

export type CapabilityWorkspaceContext = {
  activePrefix: string;
  cwdPath: string;
  files: LocalWorkspaceFile[];
  entries: WorkspaceItem[];
  workspaceContext: WorkspaceContext;
  setActivePrefix: (prefix: string) => void;
  createDirectory: (path: string) => string;
  changeDirectory: (path: string) => string;
  updateFilesystem: (
    updater: (filesystem: WorkspaceFilesystem) => WorkspaceFilesystem,
  ) => void;
  getState: () => {
    activePrefix: string;
    cwdPath: string;
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
  defaultExecutionMode?: ExecutionMode;
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
