import type { AppThreadMetadata, UpdateThreadMetadataPayload } from "../types/analysis";

export function buildThreadMetadataUpdateAction(payload: UpdateThreadMetadataPayload) {
  return {
    type: "update_thread_metadata",
    payload,
  };
}

export function buildInitialThreadMetadata(metadata: AppThreadMetadata): AppThreadMetadata {
  return {
    title: metadata.title,
    investigation_brief: metadata.investigation_brief,
    plan: metadata.plan,
    plan_execution: metadata.plan_execution,
    chart_plan: metadata.chart_plan,
    chart_cache: metadata.chart_cache,
    surface_key: metadata.surface_key,
    agent_bundle: metadata.agent_bundle,
    shell_state: metadata.shell_state,
    openai_conversation_id: metadata.openai_conversation_id,
    openai_previous_response_id: metadata.openai_previous_response_id,
    origin: metadata.origin,
  };
}
