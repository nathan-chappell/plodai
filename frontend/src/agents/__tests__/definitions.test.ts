import { describe, expect, it } from "vitest";

import {
  agricultureAgentDefinition,
  analysisAgentDefinition,
  chartAgentDefinition,
  documentAgentDefinition,
  reportAgentDefinition,
  surfaceDefinitions,
} from "../definitions";

describe("agent definitions", () => {
  it("provide compact ChatKit copy for the live and helper agents", () => {
    for (const agent of [
      agricultureAgentDefinition,
      documentAgentDefinition,
      reportAgentDefinition,
      analysisAgentDefinition,
      chartAgentDefinition,
    ]) {
      expect(agent.chatkitLead.length).toBeGreaterThan(12);
      expect(agent.chatkitPlaceholder.length).toBeGreaterThan(20);
    }
  });

  it("surfaces Agriculture and Documents as the only first-class apps", () => {
    expect(surfaceDefinitions.map((agent) => agent.id)).toEqual([
      "agriculture-agent",
      "document-agent",
    ]);
    expect(agricultureAgentDefinition.path).toBe("/agriculture");
    expect(documentAgentDefinition.path).toBe("/documents");
    expect(agricultureAgentDefinition.attachmentConfig.maxSize).toBe(10 * 1024 * 1024);
  });
});
