import type { AppChatMetadata, UpdateChatMetadataPayload } from "../types/analysis";

export function buildChatMetadataUpdateAction(payload: UpdateChatMetadataPayload) {
  return {
    type: "update_chat_metadata",
    payload,
  };
}

export function buildInitialChatMetadata(metadata: AppChatMetadata): AppChatMetadata {
  return {
    title: metadata.title,
    investigation_brief: metadata.investigation_brief,
    chart_cache: metadata.chart_cache,
    surface_key: metadata.surface_key,
    agent_bundle: metadata.agent_bundle,
    workspace_state: metadata.workspace_state,
    openai_conversation_id: metadata.openai_conversation_id,
    openai_previous_response_id: metadata.openai_previous_response_id,
    origin: metadata.origin,
  };
}
