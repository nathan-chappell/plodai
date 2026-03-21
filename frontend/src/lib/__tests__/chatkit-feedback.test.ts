import { describe, expect, it } from "vitest";

import {
  buildFeedbackSubmissionPrompt,
  buildNativeFeedbackPrompt,
} from "../chatkit-feedback";

describe("chatkit feedback helpers", () => {
  it("builds the seeded native feedback prompt", () => {
    expect(buildNativeFeedbackPrompt("positive")).toContain("feedback agent");
    expect(buildNativeFeedbackPrompt("positive")).toContain('sentiment: "thumbs up"');
    expect(buildNativeFeedbackPrompt("positive")).toContain("latest assistant response");
    expect(buildNativeFeedbackPrompt("positive")).toContain("Call get_feedback first");
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
