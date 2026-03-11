import { useMemo } from "react";
import { Bar, Doughnut, Line, Pie, Scatter } from "react-chartjs-2";
import styled from "styled-components";

import "../lib/chart";
import type { ClientChartSpec, DataRow } from "../types/analysis";

const Wrapper = styled.div`
  min-height: 280px;
  padding: 1rem;
`;

const Empty = styled.div`
  min-height: 240px;
  display: grid;
  place-items: center;
  color: var(--muted);
  text-align: center;
`;

const palette = ["#c96f3b", "#497fa2", "#8f4320", "#6f8a4f", "#b69854"];

export function DatasetChart({ spec, rows }: { spec: ClientChartSpec; rows: DataRow[] }) {
  const hasRows = rows.length > 0;

  const chartData = useMemo(() => {
    const labels = rows.map((row) => String(row[spec.labelKey] ?? ""));
    const datasets = spec.series.map((series, index) => ({
      label: series.label,
      data: rows.map((row) => Number(row[series.dataKey] ?? 0)),
      backgroundColor: series.color ?? palette[index % palette.length],
      borderColor: series.color ?? palette[index % palette.length],
      fill: false,
    }));
    return { labels, datasets };
  }, [rows, spec]);

  const scatterData = useMemo(
    () => ({
      datasets: spec.series.map((series, index) => ({
        label: series.label,
        data: rows.map((row) => ({ x: Number(row[spec.labelKey] ?? 0), y: Number(row[series.dataKey] ?? 0) })),
        backgroundColor: series.color ?? palette[index % palette.length],
      })),
    }),
    [rows, spec],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top" as const,
        },
        title: {
          display: Boolean(spec.title),
          text: spec.title,
        },
      },
    }),
    [spec.title],
  );

  return (
    <Wrapper>
      {hasRows ? (
        <>
          {spec.type === "line" ? <Line data={chartData} options={options} /> : null}
          {spec.type === "bar" ? <Bar data={chartData} options={options} /> : null}
          {spec.type === "pie" ? <Pie data={chartData} options={options} /> : null}
          {spec.type === "doughnut" ? <Doughnut data={chartData} options={options} /> : null}
          {spec.type === "scatter" ? <Scatter data={scatterData} options={options} /> : null}
        </>
      ) : (
        <Empty>Chart spec is ready. Rendered data will appear here once a client tool produces rows.</Empty>
      )}
    </Wrapper>
  );
}
