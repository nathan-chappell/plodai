import { describe, expect, it } from "vitest";

import { resolveReportDemoWorkspaceMeta } from "../../capabilities/reportFoundry";

describe("report demo workspace meta", () => {
  it("stays tied to demo state instead of transient workspace status", () => {
    expect(
      resolveReportDemoWorkspaceMeta({
        loading: false,
        error: null,
        title: "Delegated report demo",
      }),
    ).toBe("Curated scenario loaded: Delegated report demo.");
  });
});
