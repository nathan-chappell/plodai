import { useMemo } from "react";
import { Bar, Doughnut, Line, Pie, Scatter } from "react-chartjs-2";
import styled from "styled-components";

import { buildChartData, buildChartOptions, buildChartPlugins, getChartSurfaceStyle } from "../lib/chart";
import type { ClientChartSpec, DataRow } from "../types/analysis";

const Wrapper = styled.div<{ $background: string; $border: string }>`
  min-height: 300px;
  padding: 1rem;
  border-radius: var(--radius-md);
  background: ${(props) => props.$background};
  border: 1px solid ${(props) => props.$border};
`;

const Empty = styled.div`
  min-height: 240px;
  display: grid;
  place-items: center;
  color: var(--muted);
  text-align: center;
`;

export function DatasetChart({ spec, rows }: { spec: ClientChartSpec; rows: DataRow[] }) {
  const hasRows = rows.length > 0;
  const chartData = useMemo(() => buildChartData(spec, rows), [rows, spec]);
  const options = useMemo(() => buildChartOptions(spec), [spec]);
  const plugins = useMemo(() => buildChartPlugins(spec), [spec]);
  const surface = useMemo(() => getChartSurfaceStyle(spec), [spec]);

  return (
    <Wrapper $background={surface.background} $border={surface.border}>
      {hasRows ? (
        <>
          {spec.type === "line" ? <Line data={chartData as never} options={options as never} plugins={plugins} /> : null}
          {spec.type === "bar" ? <Bar data={chartData as never} options={options as never} plugins={plugins} /> : null}
          {spec.type === "pie" ? <Pie data={chartData as never} options={options as never} plugins={plugins} /> : null}
          {spec.type === "doughnut" ? <Doughnut data={chartData as never} options={options as never} plugins={plugins} /> : null}
          {spec.type === "scatter" ? <Scatter data={chartData as never} options={options as never} plugins={plugins} /> : null}
        </>
      ) : (
        <Empty>Chart spec is ready. Rendered data will appear here once a client tool produces rows.</Empty>
      )}
    </Wrapper>
  );
}
