import type { ComponentType } from "react";

import type { ClientEffect } from "../types/analysis";
import type { JsonSchema } from "../types/json-schema";
import type { LocalAttachment } from "../types/report";
import type {
  ApplyWorkspaceItemOperationPayload,
  WorkspaceItemCreatePayload,
  WorkspaceCreatedItemDetail,
  WorkspaceItemRevision,
  WorkspaceCreatedItemSummary,
  WorkspaceUploadItemSummary,
  WorkspaceState,
  WorkspaceUpdatePayload,
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

export type AgentAttachmentAcceptMap = Record<string, readonly string[]>;

export type AgentAttachmentConfig = {
  enabled: boolean;
  accept?: AgentAttachmentAcceptMap;
  maxCount?: number;
  maxSize?: number;
};

export type ClientToolHandlerContext = {
  emitEffect: (effect: ClientEffect) => void;
  emitEffects: (effects: ClientEffect[]) => void;
};

export type ClientToolHandler<
  Args = Record<string, unknown>,
  Result = Record<string, unknown>,
> = (
  args: Args,
  context: ClientToolHandlerContext,
) => Promise<Result>;

export type AgentClientTool<
  Args = Record<string, unknown>,
  Result = Record<string, unknown>,
> = FunctionToolDefinition & {
  handler: ClientToolHandler<Args, Result>;
};

export type AgentDelegationTarget = {
  agent_id: string;
  tool_name: string;
  description: string;
};

export type AgentSpec = {
  agent_id: string;
  agent_name: string;
  instructions: string;
  client_tools: FunctionToolDefinition[];
  delegation_targets: AgentDelegationTarget[];
};

export type AgentBundle = {
  root_agent_id: string;
  agents: AgentSpec[];
};

export type AgentTab = {
  id: string;
  label: string;
  visible?: (params: { role: string }) => boolean;
};

export type AgentDefinition = {
  id: string;
  path: string;
  navLabel: string;
  title: string;
  eyebrow: string;
  description: string;
  chatkitLead: string;
  chatkitPlaceholder: string;
  tabs: AgentTab[];
  showInSidebar?: boolean;
  showInComposer?: boolean;
  composerOrder?: number;
  composerLabel?: string;
  composerShortLabel?: string;
  composerIcon?: ComposerToolIcon;
  composerPlaceholder?: string;
  previewPriority?: number;
  attachmentConfig: AgentAttachmentConfig;
};

export type AgentRuntimeContext = {
  workspaceId: string;
  workspaceName: string;
  agentId?: string;
  agentTitle?: string;
  activeAgentId: string;
  selectedFileId?: string | null;
  selectedArtifactId?: string | null;
  currentReportArtifactId?: string | null;
  listFiles: () => WorkspaceUploadItemSummary[];
  getFile: (fileId: string) => WorkspaceUploadItemSummary | null;
  resolveLocalFile: (fileId: string) => Promise<LocalAttachment | null>;
  registerFile: (
    file: LocalAttachment,
    options?: {
      sourceItemId?: string | null;
    },
  ) => Promise<WorkspaceUploadItemSummary>;
  removeFile: (fileId: string) => Promise<void>;
  listArtifacts: () => WorkspaceCreatedItemSummary[];
  getArtifact: (artifactId: string) => Promise<WorkspaceCreatedItemDetail | null>;
  listArtifactRevisions: (
    artifactId: string,
  ) => Promise<WorkspaceItemRevision[]>;
  createArtifact: (
    payload: WorkspaceItemCreatePayload,
  ) => Promise<WorkspaceCreatedItemDetail>;
  applyArtifactOperation: (
    artifactId: string,
    payload: ApplyWorkspaceItemOperationPayload,
  ) => Promise<WorkspaceCreatedItemDetail>;
  updateWorkspace: (payload: WorkspaceUpdatePayload) => Promise<WorkspaceState | null>;
};

export type AgentModule = {
  definition: AgentDefinition;
  buildAgentSpec: (workspace: AgentRuntimeContext) => AgentSpec;
  bindClientTools: (
    workspace: AgentRuntimeContext,
  ) => AgentClientTool[] | Promise<AgentClientTool[]>;
  Page: ComponentType<Record<string, never>>;
};

export type AgentRuntimeModule = Pick<
  AgentModule,
  "definition" | "buildAgentSpec" | "bindClientTools"
>;
