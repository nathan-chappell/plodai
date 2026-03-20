import { describe, expect, it } from "vitest";

import {
  buildFeedbackSubmissionPrompt,
  buildProvideFeedbackPrompt,
} from "../chatkit-feedback";

describe("chatkit feedback helpers", () => {
  it("builds the seeded feedback prompt", () => {
    expect(buildProvideFeedbackPrompt()).toContain("feedback agent");
    expect(buildProvideFeedbackPrompt()).toContain("latest assistant response");
    expect(buildProvideFeedbackPrompt()).toContain("have not written the feedback yet");
    expect(buildProvideFeedbackPrompt()).toContain("Call get_feedback first");
  });

  it("builds a confirmation prompt from the submitted widget payload", () => {
    const message = buildFeedbackSubmissionPrompt({
      sentiment: "negative",
      selected_option: "The flow was confusing.",
    });

    expect(message).toContain("confirmed sentiment is negative");
    expect(message).toContain("The flow was confusing.");
    expect(message).toContain("Call send_feedback next");
    expect(message).toContain("Do not call get_feedback again");
  });
});
