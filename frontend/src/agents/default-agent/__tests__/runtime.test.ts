import { describe, expect, it } from "vitest";

import { defaultAgentRuntimeModule } from "../runtime";

describe("default-agent runtime", () => {
  it("treats tour launches as front-of-house prep followed by explicit delegation", () => {
    const instructions = defaultAgentRuntimeModule.buildAgentSpec().instructions;

    expect(instructions).toContain("front-of-house router");
    expect(instructions).toContain("list_tour_scenarios");
    expect(instructions).toContain("launch_tour_scenario");
    expect(instructions).toContain("guided tour picker");
    expect(instructions).toContain("do not add another assistant reply in the same turn");
    expect(instructions).not.toContain("queue the first tour turn automatically");
  });
});
