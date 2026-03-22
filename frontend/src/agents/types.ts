import type { ComponentType } from "react";

import type { ClientEffect } from "../types/analysis";
import type { JsonSchema } from "../types/json-schema";
import type { LocalWorkspaceFile } from "../types/report";
import type { AgentResourceRecord, AgentShellState } from "../types/shell";

export type FunctionToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
  strict?: boolean;
  display?: ToolDisplaySpec;
};

export type TourPickerDisplayScenario = {
  scenario_id: string;
  title: string;
  summary: string;
  workspace_name: string;
  target_agent_id: string;
  default_asset_count: number;
};

export type TourPickerDisplaySpec = {
  title: string;
  summary: string;
  scenarios: TourPickerDisplayScenario[];
};

export type ToolDisplaySpec = {
  label?: string;
  prominent_args?: string[];
  omit_args?: string[];
  arg_labels?: Record<string, string>;
  tour_picker?: TourPickerDisplaySpec;
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
  selectAgent: (agentId: string) => void;
  replaceAgentResources: (
    agentId: string,
    resources: AgentResourceRecord[],
  ) => void;
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
  agentId?: string;
  agentTitle?: string;
  activeAgentId: string;
  getAgentState: (agentId?: string) => AgentShellState;
  updateAgentState: (
    agentId: string | undefined,
    updater: (state: AgentShellState) => AgentShellState,
  ) => void;
  replaceAgentResources: (
    agentId: string | undefined,
    resources: AgentResourceRecord[],
  ) => void;
  listAgentResources: (agentId?: string) => AgentResourceRecord[];
  listSharedResources: () => AgentResourceRecord[];
  resolveResource: (resourceId: string) => AgentResourceRecord | null;
  selectAgent: (agentId: string) => void;
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
