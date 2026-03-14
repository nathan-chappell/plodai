import type { ClientEffect } from "../types/analysis";

export type FunctionToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown> | null;
  strict?: boolean;
};

export type ClientToolHandlerContext = {
  emitEffect: (effect: ClientEffect) => void;
  emitEffects: (effects: ClientEffect[]) => void;
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
