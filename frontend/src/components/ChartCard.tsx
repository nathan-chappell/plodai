import styled from "styled-components";

import type { ReportChart } from "../types/report";

const Card = styled.article`
  background: linear-gradient(180deg, rgba(255, 253, 249, 0.98), rgba(248, 241, 234, 0.96));
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 1.2rem;
  min-height: 280px;
  box-shadow: var(--shadow);
`;

const Heading = styled.h3`
  margin: 0 0 0.75rem;
  font-family: var(--font-display);
  font-size: 1.25rem;
`;

const Preview = styled.div`
  min-height: 200px;
  border-radius: var(--radius-md);
  border: 1px dashed rgba(31, 41, 55, 0.18);
  background: rgba(201, 111, 59, 0.08);
  display: grid;
  place-items: center;
  color: var(--muted);
  padding: 1rem;
  text-align: center;
`;

const Code = styled.pre`
  margin: 1rem 0 0;
  padding: 0.9rem;
  border-radius: var(--radius-md);
  background: #221f1b;
  color: #f8f6f2;
  overflow: auto;
  font-size: 0.85rem;
`;

export function ChartCard({ chart }: { chart: ReportChart }) {
  return (
    <Card>
      <Heading>{chart.title}</Heading>
      <Preview>
        {chart.image_data_url ? (
          <img alt={chart.title} src={chart.image_data_url} style={{ maxWidth: "100%" }} />
        ) : (
          <div>
            <strong>{chart.chart_type.toUpperCase()} chart placeholder</strong>
            <div>Render this client-side, cache by query id, then return the image to the backend.</div>
          </div>
        )}
      </Preview>
      <Code>{JSON.stringify(chart.spec, null, 2)}</Code>
    </Card>
  );
}
