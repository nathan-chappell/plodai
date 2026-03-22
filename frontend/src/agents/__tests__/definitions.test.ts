import { describe, expect, it } from "vitest";

import {
  agricultureAgentDefinition,
  analysisAgentDefinition,
  chartAgentDefinition,
  documentAgentDefinition,
  defaultAgentDefinition,
  reportAgentDefinition,
} from "../definitions";

describe("agent definitions", () => {
  it("provide compact ChatKit copy for each core agent", () => {
    for (const agent of [
      defaultAgentDefinition,
      reportAgentDefinition,
      analysisAgentDefinition,
      chartAgentDefinition,
      documentAgentDefinition,
      agricultureAgentDefinition,
    ]) {
      expect(agent.chatkitLead.length).toBeGreaterThan(12);
      expect(agent.chatkitPlaceholder.length).toBeGreaterThan(20);
    }
  });
});
