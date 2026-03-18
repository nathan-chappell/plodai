import { describe, expect, it } from "vitest";

import { buildFeedbackSummaryMessage, buildProvideFeedbackPrompt } from "../chatkit-feedback";

describe("chatkit feedback helpers", () => {
  it("builds the seeded feedback prompt", () => {
    expect(buildProvideFeedbackPrompt()).toContain("feedback agent");
    expect(buildProvideFeedbackPrompt()).toContain("latest assistant response");
  });

  it("builds a structured summary message", () => {
    const message = buildFeedbackSummaryMessage({
      kind: "negative",
      label: "ui",
      message: "The flow was confusing.",
    });

    expect(message).toContain("Sentiment: negative.");
    expect(message).toContain("Area: ui.");
    expect(message).toContain("The flow was confusing.");
  });
});
