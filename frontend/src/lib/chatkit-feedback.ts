export type FeedbackKind = "positive" | "negative";
export type FeedbackLabel = "ui" | "tools" | "behavior";
export type FeedbackOrigin = "interactive" | "ui_integration_test";

export type FeedbackActionPayload = {
  feedback_id?: string;
  kind?: string;
  label?: string;
  message?: string;
};

export function buildProvideFeedbackPrompt(): string {
  return [
    "Please hand off to the feedback agent.",
    "I want to provide feedback on the latest assistant response in this thread.",
    "Keep the exchange brief and focus on capturing structured feedback.",
  ].join(" ");
}

export function buildFeedbackSummaryMessage(payload: FeedbackActionPayload): string {
  const detailLines = [
    "Structured feedback submitted for the latest assistant response.",
    `Sentiment: ${normalizeKind(payload.kind) ?? "unspecified"}.`,
    `Area: ${normalizeLabel(payload.label) ?? "unspecified"}.`,
    `Message: ${normalizeMessage(payload.message) ?? "None provided."}`,
  ];
  return detailLines.join(" ");
}

function normalizeKind(value: string | undefined): FeedbackKind | null {
  return value === "positive" || value === "negative" ? value : null;
}

function normalizeLabel(value: string | undefined): FeedbackLabel | null {
  return value === "ui" || value === "tools" || value === "behavior" ? value : null;
}

function normalizeMessage(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
