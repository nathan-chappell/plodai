// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  parseLiveDemoValidationReply,
  type LiveThreadCostSnapshot,
} from "../test-support/chatkit-live";

const COST_SNAPSHOT: LiveThreadCostSnapshot = {
  scope: "before_current_turn",
  input_tokens: 120,
  output_tokens: 30,
  cost_usd: 0.00123456,
};

describe("live demo validator reply parsing", () => {
  it("parses a passing validator reply", () => {
    const validation = parseLiveDemoValidationReply({
      text: [
        "VERDICT: PASS",
        "SUMMARY: The report demo completed the expected workflow and final output looked reasonable.",
        "CHART_SEEN: YES - I observed chart evidence in the same thread context.",
        "FAILURES: none",
        "COST_USD: 0.00123456",
      ].join("\n"),
      expectChart: true,
      costSnapshot: COST_SNAPSHOT,
    });

    expect(validation.passed).toBe(true);
    expect(validation.summary).toContain("expected workflow");
    expect(validation.chart_seen).toBe(true);
    expect(validation.failures).toEqual([]);
    expect(validation.cost_snapshot).toEqual(COST_SNAPSHOT);
  });

  it("rejects malformed validator replies", () => {
    expect(() =>
      parseLiveDemoValidationReply({
        text: "VERDICT: PASS\nSUMMARY: Missing the rest",
        expectChart: false,
        costSnapshot: COST_SNAPSHOT,
      }),
    ).toThrow(/exactly 5 non-empty lines/i);
  });

  it("surfaces explicit validator failures", () => {
    const validation = parseLiveDemoValidationReply({
      text: [
        "VERDICT: FAIL",
        "SUMMARY: The demo stopped too early and never landed the expected output.",
        "CHART_SEEN: YES - I saw a chart in the thread, but it was not tied to the final answer well enough.",
        "FAILURES: Final report item was too weak ; Expected outcome coverage was incomplete",
        "COST_USD: 0.00123456",
      ].join("\n"),
      expectChart: true,
      costSnapshot: COST_SNAPSHOT,
    });

    expect(validation.passed).toBe(false);
    expect(validation.summary).toContain("stopped too early");
    expect(validation.failures).toEqual([
      "Final report item was too weak",
      "Expected outcome coverage was incomplete",
    ]);
  });

  it("fails when a chart was expected but the validator could not confirm seeing one", () => {
    const validation = parseLiveDemoValidationReply({
      text: [
        "VERDICT: PASS",
        "SUMMARY: Most of the workflow looked correct.",
        "CHART_SEEN: NO - I did not observe chart evidence in the same thread context.",
        "FAILURES: none",
        "COST_USD: 0.00123456",
      ].join("\n"),
      expectChart: true,
      costSnapshot: COST_SNAPSHOT,
    });

    expect(validation.passed).toBe(false);
    expect(validation.failures).toContain(
      "Validator did not confirm chart evidence: I did not observe chart evidence in the same thread context.",
    );
  });

  it("uses the reported COST_USD when no explicit snapshot was exposed", () => {
    const validation = parseLiveDemoValidationReply({
      text: [
        "VERDICT: PASS",
        "SUMMARY: The workflow completed successfully.",
        "CHART_SEEN: YES - I observed chart evidence in the same thread context.",
        "FAILURES: none",
        "COST_USD: 0.0202104",
      ].join("\n"),
      expectChart: true,
    });

    expect(validation.passed).toBe(true);
    expect(validation.cost_snapshot).toEqual({
      scope: "before_current_turn",
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0.0202104,
    });
  });
});
