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
    dataset_ids: metadata.dataset_ids,
    datasets: metadata.datasets,
    chart_cache: metadata.chart_cache,
    openai_conversation_id: metadata.openai_conversation_id,
    openai_previous_response_id: metadata.openai_previous_response_id,
  };
}
