import { useMemo } from "react";
import { Bar, Doughnut, Line, Pie, Scatter } from "react-chartjs-2";

import { buildChartData, buildChartOptions, buildChartPlugins, getChartSurfaceStyle } from "../lib/chart";
import { DatasetChartEmpty, DatasetChartWrapper } from "./styles";
import type { ClientChartSpec, DataRow } from "../types/analysis";

export function DatasetChart({ spec, rows }: { spec: ClientChartSpec; rows: DataRow[] }) {
  const hasRows = rows.length > 0;
  const chartData = useMemo(() => buildChartData(spec, rows), [rows, spec]);
  const options = useMemo(() => buildChartOptions(spec), [spec]);
  const plugins = useMemo(() => buildChartPlugins(spec), [spec]);
  const surface = useMemo(() => getChartSurfaceStyle(spec), [spec]);

  return (
    <DatasetChartWrapper $background={surface.background} $border={surface.border} data-testid="dataset-chart">
      {hasRows ? (
        <>
          {spec.type === "line" ? <Line data={chartData as never} options={options as never} plugins={plugins} /> : null}
          {spec.type === "bar" ? <Bar data={chartData as never} options={options as never} plugins={plugins} /> : null}
          {spec.type === "pie" ? <Pie data={chartData as never} options={options as never} plugins={plugins} /> : null}
          {spec.type === "doughnut" ? <Doughnut data={chartData as never} options={options as never} plugins={plugins} /> : null}
          {spec.type === "scatter" ? <Scatter data={chartData as never} options={options as never} plugins={plugins} /> : null}
        </>
      ) : (
        <DatasetChartEmpty>Chart spec is ready. Rendered data will appear here once a client tool produces rows.</DatasetChartEmpty>
      )}
    </DatasetChartWrapper>
  );
}
