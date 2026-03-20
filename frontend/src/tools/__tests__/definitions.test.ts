import { describe, expect, it } from "vitest";

import {
  chartAgentCapability,
  csvAgentCapability,
  pdfAgentCapability,
  reportAgentCapability,
} from "../definitions";

describe("capability definitions", () => {
  it("provide compact ChatKit copy for each core capability", () => {
    for (const capability of [
      reportAgentCapability,
      csvAgentCapability,
      chartAgentCapability,
      pdfAgentCapability,
    ]) {
      expect(capability.chatkitLead.length).toBeGreaterThan(12);
      expect(capability.chatkitPlaceholder.length).toBeGreaterThan(20);
    }
  });
});
