import type { ComponentType } from "react";
import type { ClientEffect } from "../types/analysis";
import type { JsonSchema } from "../types/json-schema";
import type { LocalWorkspaceFile } from "../types/report";

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
  appendFiles: (files: LocalWorkspaceFile[]) => void;
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
  files: LocalWorkspaceFile[];
  accept?: string;
  onSelectFiles: (files: FileList | null) => Promise<void>;
  onClearFiles: () => void;
  onRemoveFile?: (fileId: string) => void;
};

export type CapabilityWorkspaceContext = {
  files: LocalWorkspaceFile[];
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
  buildAgentSpec: () => CapabilityAgentSpec;
  buildDemoScenario: () => CapabilityDemoScenario | Promise<CapabilityDemoScenario>;
  bindClientTools: (
    workspace: CapabilityWorkspaceContext,
  ) => CapabilityClientTool[] | Promise<CapabilityClientTool[]>;
  Page: ComponentType<{
    onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
  }>;
};
