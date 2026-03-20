import { executeToolWithBroker } from "../../lib/client-tool-broker";
import type {
  ClientEffect,
  ClientToolArgsMap,
  ClientToolName,
} from "../../types/analysis";
import type { JsonObjectSchema, JsonSchema } from "../../types/json-schema";
import type {
  CapabilityClientTool,
  CapabilityWorkspaceContext,
  FunctionToolDefinition,
  ToolDisplaySpec,
} from "../types";

export function buildToolDefinition(
  name: string,
  description: string,
  parameters: JsonSchema,
  display?: ToolDisplaySpec,
): FunctionToolDefinition {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters,
    display,
  };
}

export function cloneSchema<T extends JsonSchema>(schema: T): T {
  return JSON.parse(JSON.stringify(schema)) as T;
}

export function isObjectSchema(schema: JsonSchema): schema is JsonObjectSchema {
  return "type" in schema && schema.type === "object";
}

async function invokeBrokeredTool<Name extends ClientToolName>(
  workspace: CapabilityWorkspaceContext,
  toolName: Name,
  args: ClientToolArgsMap[Name],
  context: { emitEffects: (effects: ClientEffect[]) => void },
): Promise<Record<string, unknown>> {
  const result = await executeToolWithBroker(workspace, toolName, args);
  if (result.effects.length) {
    context.emitEffects(result.effects);
  }
  return result.payload;
}

export function createBrokeredCapabilityTool<Name extends ClientToolName>(
  workspace: CapabilityWorkspaceContext,
  definition: FunctionToolDefinition,
  toolName: Name,
): CapabilityClientTool {
  return {
    ...definition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, toolName, args as ClientToolArgsMap[Name], context),
  } as CapabilityClientTool;
}
