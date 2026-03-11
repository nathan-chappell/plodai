import ReactMarkdown from "react-markdown";
import styled from "styled-components";

import type { ReportSection } from "../types/report";
import { displayHeadingCss, strongSurfaceCss } from "../ui/primitives";

const Card = styled.article`
  ${strongSurfaceCss};
  padding: 1.2rem;
`;

const Heading = styled.h3`
  ${displayHeadingCss};
  margin: 0 0 1rem;
  font-size: 1.35rem;
`;

const Body = styled.div`
  color: var(--muted);
  line-height: 1.7;

  h2,
  h3 {
    color: var(--ink);
    font-family: var(--font-display);
  }
`;

export function NarrativeCard({ section }: { section: ReportSection }) {
  return (
    <Card>
      <Heading>{section.title}</Heading>
      <Body>
        <ReactMarkdown>{section.markdown}</ReactMarkdown>
      </Body>
    </Card>
  );
}
