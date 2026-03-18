import { executeToolRequest } from "./client-tool-runtime";

import type { ToolExecutionRequestV1, ToolExecutionResultV1 } from "../types/tool-runtime";

self.onmessage = async (event: MessageEvent<ToolExecutionRequestV1>) => {
  try {
    const result = await executeToolRequest(event.data);
    self.postMessage(result satisfies ToolExecutionResultV1);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Client tool worker failed.";
    self.postMessage({
      version: "v1",
      request_id: event.data.request_id,
      tool_name: event.data.tool_name,
      payload: {
        error: message,
      },
      mutations: [],
      effects: [],
      warnings: [message],
    } satisfies ToolExecutionResultV1);
  }
};
