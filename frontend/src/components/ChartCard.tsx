import { DatasetChart } from "./DatasetChart";
import {
  ChartCardCode,
  ChartCardHeading,
  ChartCardPreview,
  ChartCardPreviewImage,
  ChartCardShell,
} from "./styles";
import type { ClientChartSpec } from "../types/analysis";
import type { ReportChart } from "../types/report";

function isClientChartSpec(spec: ReportChart["spec"]): spec is ClientChartSpec {
  return typeof spec === "object" && spec !== null && "type" in spec && "label_key" in spec && "series" in spec;
}

export function ChartCard({ chart }: { chart: ReportChart }) {
  return (
    <ChartCardShell>
      <ChartCardHeading>{chart.title}</ChartCardHeading>
      <ChartCardPreview>
        {chart.image_data_url ? (
          <ChartCardPreviewImage alt={chart.title} src={chart.image_data_url} />
        ) : isClientChartSpec(chart.spec) ? (
          <DatasetChart spec={chart.spec} rows={[]} />
        ) : (
          <div>
            <strong>{chart.chart_type.toUpperCase()} chart placeholder</strong>
            <div>Render this client-side, cache by query id, then return the image to the backend.</div>
          </div>
        )}
      </ChartCardPreview>
      <ChartCardCode>{JSON.stringify(chart.spec, null, 2)}</ChartCardCode>
    </ChartCardShell>
  );
}
