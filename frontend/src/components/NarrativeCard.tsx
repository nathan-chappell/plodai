import ReactMarkdown from "react-markdown";

import { NarrativeCardBody, NarrativeCardHeading, NarrativeCardShell } from "./styles";
import type { ReportSection } from "../types/report";

export function NarrativeCard({ section }: { section: ReportSection }) {
  return (
    <NarrativeCardShell>
      <NarrativeCardHeading>{section.title}</NarrativeCardHeading>
      <NarrativeCardBody>
        <ReactMarkdown>{section.markdown}</ReactMarkdown>
      </NarrativeCardBody>
    </NarrativeCardShell>
  );
}
