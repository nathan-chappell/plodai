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

export type CapabilityManifest = {
  capability_id: string;
  agent_name: string;
  instructions: string;
  client_tools: FunctionToolDefinition[];
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
