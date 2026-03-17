import { describe, expect, it } from "vitest";

import { buildCapabilityBundleForRoot, getCapabilityModule } from "../../capabilities/registry";

function capabilityIdsFor(rootCapabilityId: string): string[] {
  return buildCapabilityBundleForRoot(rootCapabilityId).capabilities.map(
    (capability) => capability.capability_id,
  );
}

describe("capability registry", () => {
  it("returns the expected dependency graph for the report agent", () => {
    expect(capabilityIdsFor("report-agent")).toEqual([
      "report-agent",
      "csv-agent",
      "chart-agent",
      "pdf-agent",
    ]);
  });

  it("returns the expected dependency graph for the csv agent", () => {
    expect(capabilityIdsFor("csv-agent")).toEqual(["csv-agent", "chart-agent"]);
  });

  it("returns standalone bundles for chart and pdf agents", () => {
    expect(capabilityIdsFor("chart-agent")).toEqual(["chart-agent"]);
    expect(capabilityIdsFor("pdf-agent")).toEqual(["pdf-agent"]);
  });

  it("exposes capability modules by id", () => {
    expect(getCapabilityModule("report-agent")?.definition.path).toBe("/capabilities/report-agent");
    expect(getCapabilityModule("missing-agent")).toBeNull();
  });
});
