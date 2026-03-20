export type FeedbackKind = "positive" | "negative";
export type FeedbackOrigin = "interactive" | "ui_integration_test";

export type FeedbackSessionActionPayload = {
  session_id?: string;
  selected_option?: string;
  sentiment?: string;
  message?: string;
};

export function buildProvideFeedbackPrompt(): string {
  return [
    "Please hand off to the feedback agent.",
    "I want to provide feedback on the latest assistant response in this thread.",
    "I have not written the feedback yet, so the feedback agent should start by gathering it.",
    "Call get_feedback first and open the structured widget immediately.",
    "Do not ask me to type feedback in chat before opening the widget.",
    "Keep the exchange brief and focused on capturing feedback only.",
  ].join(" ");
}

export function buildFeedbackSubmissionPrompt(
  payload: FeedbackSessionActionPayload,
): string {
  const message = normalizeFeedbackMessage(payload);
  const sentiment = normalizeKind(payload.sentiment) ?? "negative";
  return [
    "Please hand off to the feedback agent.",
    "The user has confirmed feedback for the latest assistant response in this thread.",
    `The confirmed sentiment is ${sentiment}.`,
    `The confirmed feedback message is: ${message}.`,
    "The feedback is already confirmed in the widget.",
    "Call send_feedback next.",
    "Do not call get_feedback again and do not continue the original task.",
  ].join(" ");
}

function normalizeKind(value: string | undefined): FeedbackKind | null {
  return value === "positive" || value === "negative" ? value : null;
}

function normalizeFeedbackMessage(payload: FeedbackSessionActionPayload): string {
  const directMessage = payload.message?.trim();
  if (directMessage) {
    return directMessage;
  }
  const selectedOption = payload.selected_option?.trim();
  if (selectedOption) {
    return selectedOption;
  }
  return "No message was provided.";
}
