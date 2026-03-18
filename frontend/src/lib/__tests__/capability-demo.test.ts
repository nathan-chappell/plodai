import { describe, expect, it } from "vitest";

import { capabilityModules } from "../../capabilities/registry";

describe("capability demos", () => {
  it("builds one valid demo scenario for each capability", async () => {
    const scenarios = await Promise.all(
      capabilityModules.map(async (capabilityModule) => ({
        capabilityId: capabilityModule.definition.id,
        scenario: await capabilityModule.buildDemoScenario(),
      })),
    );

    for (const { capabilityId, scenario } of scenarios) {
      expect(scenario.id).toBeTruthy();
      expect(scenario.title).toBeTruthy();
      expect(scenario.summary).toBeTruthy();
      expect(scenario.initialPrompt).toBeTruthy();
      expect(scenario.workspaceSeed.length).toBeGreaterThan(0);
      expect(scenario.defaultExecutionMode).toBe("batch");
      expect(scenario.expectedOutcomes?.length ?? 0).toBeGreaterThan(0);
      expect(scenario.workspaceSeed.every((file) => file.id && file.name && file.kind)).toBe(true);
      expect(capabilityId).toBeTruthy();
    }
  });
});
