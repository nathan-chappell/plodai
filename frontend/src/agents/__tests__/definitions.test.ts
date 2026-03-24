import { describe, expect, it } from "vitest";

import {
  plodaiAgentDefinition,
  analysisAgentDefinition,
  chartAgentDefinition,
  documentAgentDefinition,
  reportAgentDefinition,
  surfaceDefinitions,
} from "../definitions";

describe("agent definitions", () => {
  it("provide compact ChatKit copy for the live and helper agents", () => {
    for (const agent of [
      plodaiAgentDefinition,
      documentAgentDefinition,
      reportAgentDefinition,
      analysisAgentDefinition,
      chartAgentDefinition,
    ]) {
      expect(agent.chatkitLead.length).toBeGreaterThan(12);
      expect(agent.chatkitPlaceholder.length).toBeGreaterThan(20);
    }
  });

  it("surfaces PlodAI and Documents as the only first-class apps", () => {
    expect(surfaceDefinitions.map((agent) => agent.id)).toEqual([
      "plodai-agent",
      "document-agent",
    ]);
    expect(plodaiAgentDefinition.path).toBe("/plodai");
    expect(documentAgentDefinition.path).toBe("/documents");
    expect(plodaiAgentDefinition.title).toBe("PlodAI");
    expect(plodaiAgentDefinition.navLabel).toBe("PlodAI");
    expect(plodaiAgentDefinition.attachmentConfig.maxSize).toBe(10 * 1024 * 1024);
    expect(plodaiAgentDefinition.description.toLowerCase()).toContain("crop");
    expect(plodaiAgentDefinition.chatkitPlaceholder.toLowerCase()).toContain("seasonal");
  });
});
