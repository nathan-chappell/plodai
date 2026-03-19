import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const capabilityDirs = [
  "chart-agent",
  "csv-agent",
  "feedback-agent",
  "pdf-agent",
  "report-agent",
] as const;

const capabilitiesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../capabilities",
);

describe("capability folder structure", () => {
  it("keeps every capability folder on the conventional public shape", () => {
    for (const capabilityDir of capabilityDirs) {
      expect(existsSync(path.join(capabilitiesRoot, capabilityDir, "index.ts"))).toBe(true);
      expect(existsSync(path.join(capabilitiesRoot, capabilityDir, "demo.ts"))).toBe(true);
      expect(existsSync(path.join(capabilitiesRoot, capabilityDir, "tools.ts"))).toBe(true);
      expect(existsSync(path.join(capabilitiesRoot, capabilityDir, "instructions.ts"))).toBe(false);
    }
  });
});
