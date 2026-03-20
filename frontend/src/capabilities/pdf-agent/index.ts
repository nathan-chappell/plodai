import { pdfAgentCapability } from "../definitions";
import { PdfAgentPage } from "../pdfAgent";
import type { CapabilityModule } from "../types";
import { buildPdfAgentDemoScenario } from "./demo";
import { pdfAgentRuntimeModule } from "./runtime";

const pdfAgentModule: CapabilityModule = {
  ...pdfAgentRuntimeModule,
  definition: pdfAgentCapability,
  buildDemoScenario: () => buildPdfAgentDemoScenario(),
  Page: PdfAgentPage,
};

export default pdfAgentModule;
