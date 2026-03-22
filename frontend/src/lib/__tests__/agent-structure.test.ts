import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const agentDirs = [
  "default-agent",
  "agriculture-agent",
  "analysis-agent",
  "chart-agent",
  "document-agent",
  "feedback-agent",
  "report-agent",
] as const;

const agentsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../agents",
);

describe("agent folder structure", () => {
  it("keeps every agent folder on the conventional public shape", () => {
    for (const agentDir of agentDirs) {
      expect(existsSync(path.join(agentsRoot, agentDir, "index.ts"))).toBe(true);
      expect(existsSync(path.join(agentsRoot, agentDir, "tools.ts"))).toBe(true);
      expect(existsSync(path.join(agentsRoot, agentDir, "instructions.ts"))).toBe(false);
    }
  });
});
