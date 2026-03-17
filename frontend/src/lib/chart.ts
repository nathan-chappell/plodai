import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type Plugin,
} from "chart.js";

import type { ClientChartSpec, DataRow } from "../types/analysis";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

type ChartPresetTheme = {
  palette: string[];
  grid: string;
  text: string;
  accent: string;
  background: string;
};

const PRESETS: Record<NonNullable<ClientChartSpec["style_preset"]>, ChartPresetTheme> = {
  editorial: {
    palette: ["#C96F3B", "#497FA2", "#8F4320", "#6F8A4F", "#B69854", "#B55088", "#4F6D7A", "#D58C5B"],
    grid: "rgba(44, 62, 80, 0.12)",
    text: "#22303C",
    accent: "#C96F3B",
    background: "rgba(255, 250, 244, 0.9)",
  },
  sunrise: {
    palette: ["#F28C54", "#E6B655", "#D45769", "#7C89C7", "#5DA5A3", "#B2648B", "#ED6A5A", "#F4C95D"],
    grid: "rgba(148, 92, 68, 0.14)",
    text: "#412A22",
    accent: "#F28C54",
    background: "rgba(255, 245, 236, 0.94)",
  },
  ocean: {
    palette: ["#2E6F95", "#4AA3A1", "#73A9D8", "#205072", "#8BC7C2", "#547AA5", "#2F6690", "#58A4B0"],
    grid: "rgba(32, 80, 114, 0.15)",
    text: "#173042",
    accent: "#2E6F95",
    background: "rgba(240, 249, 252, 0.94)",
  },
  forest: {
    palette: ["#496A4D", "#789B59", "#C78A3B", "#335C45", "#A2B86C", "#8C5E34", "#5B8E7D", "#B7B95E"],
    grid: "rgba(51, 92, 69, 0.15)",
    text: "#203127",
    accent: "#496A4D",
    background: "rgba(244, 249, 241, 0.94)",
  },
  mono: {
    palette: ["#1F2933", "#52606D", "#7B8794", "#9AA5B1", "#CBD2D9", "#3E4C59", "#616E7C", "#BCCCDC"],
    grid: "rgba(31, 41, 51, 0.12)",
    text: "#1F2933",
    accent: "#52606D",
    background: "rgba(249, 250, 251, 0.96)",
  },
  ledger: {
    palette: ["#204B57", "#89B0AE", "#E4DCCF", "#A05C39", "#2C2C34", "#D1A054", "#6D8A96", "#6B665C"],
    grid: "rgba(32, 75, 87, 0.12)",
    text: "#17313A",
    accent: "#204B57",
    background: "rgba(250, 247, 242, 0.96)",
  },
  amber: {
    palette: ["#A95C00", "#E78A00", "#FFD166", "#8B4513", "#7C6A0A", "#D8572A", "#A47148", "#E09F3E"],
    grid: "rgba(169, 92, 0, 0.14)",
    text: "#3A2813",
    accent: "#E78A00",
    background: "rgba(255, 248, 235, 0.96)",
  },
  cobalt: {
    palette: ["#2448C0", "#4E7BFF", "#7CB7FF", "#163172", "#3A86FF", "#6C9BCF", "#30475E", "#6A8DFF"],
    grid: "rgba(36, 72, 192, 0.14)",
    text: "#18264A",
    accent: "#2448C0",
    background: "rgba(243, 247, 255, 0.96)",
  },
  terracotta: {
    palette: ["#B8573B", "#D98E73", "#7C3A2B", "#E9C4A1", "#8D5B4C", "#F4A261", "#9C6644", "#E76F51"],
    grid: "rgba(184, 87, 59, 0.14)",
    text: "#3D241D",
    accent: "#B8573B",
    background: "rgba(255, 246, 242, 0.96)",
  },
  midnight: {
    palette: ["#86A8FF", "#5EEAD4", "#FCA5A5", "#C4B5FD", "#FDE68A", "#67E8F9", "#F9A8D4", "#93C5FD"],
    grid: "rgba(134, 168, 255, 0.18)",
    text: "#E5EDF7",
    accent: "#86A8FF",
    background: "rgba(16, 24, 40, 0.96)",
  },
};

const HIDDEN_CHART_WIDTH = 1200;
const HIDDEN_CHART_HEIGHT = 720;

export function buildChartData(spec: ClientChartSpec, rows: DataRow[]) {
  const theme = getTheme(spec);
  const labels = rows.map((row) => String(row[spec.label_key] ?? ""));

  if (spec.type === "scatter") {
    return {
      datasets: spec.series.map((series, index) => ({
        label: series.label,
        data: rows.map((row) => ({ x: Number(row[spec.label_key] ?? 0), y: Number(row[series.data_key] ?? 0) })),
        backgroundColor: series.color ?? theme.palette[index % theme.palette.length],
        borderColor: series.color ?? theme.palette[index % theme.palette.length],
        pointRadius: 5,
        pointHoverRadius: 7,
      })),
    };
  }

  return {
    labels,
    datasets: spec.series.map((series, index) => {
      const values = rows.map((row) => Number(row[series.data_key] ?? 0));
      const seriesColors = buildSeriesColors(theme, rows.length, index);
      const baseColor = series.color ?? theme.palette[index % theme.palette.length];
      const multiPointColors = series.color ? rows.map(() => series.color as string) : seriesColors;

      if (spec.type === "pie" || spec.type === "doughnut") {
        return {
          label: series.label,
          data: values,
          backgroundColor: multiPointColors,
          borderColor: multiPointColors.map((color) => blendWithWhite(color, 0.18)),
          hoverBackgroundColor: multiPointColors.map((color) => blendWithBlack(color, 0.1)),
          borderWidth: 1.5,
          hoverBorderWidth: 2,
        };
      }

      const singleSeriesBar = spec.type === "bar" && spec.series.length === 1 && !spec.stacked;
      return {
        label: series.label,
        data: values,
        backgroundColor: singleSeriesBar
          ? multiPointColors.map((color) => buildFillColor(color, spec.type))
          : buildFillColor(baseColor, spec.type),
        borderColor: singleSeriesBar ? multiPointColors : baseColor,
        borderWidth: spec.type === "line" ? 3 : 1.5,
        borderRadius: spec.type === "bar" ? 10 : 0,
        borderSkipped: false,
        fill: spec.fill_area ?? (spec.type === "line"),
        tension: (spec.smooth ?? (spec.type === "line")) ? 0.35 : 0,
        pointRadius: spec.type === "line" ? 3 : 0,
        pointHoverRadius: spec.type === "line" ? 6 : 0,
        pointBackgroundColor: baseColor,
        pointBorderColor: "#ffffff",
        hoverBackgroundColor: singleSeriesBar ? multiPointColors.map((color) => blendWithBlack(color, 0.1)) : baseColor,
      };
    }),
  };
}

export function buildChartOptions(spec: ClientChartSpec) {
  const theme = getTheme(spec);
  const interactive = spec.interactive ?? true;
  const showLegend = spec.show_legend ?? (spec.type === "pie" || spec.type === "doughnut" ? true : spec.series.length > 1);
  const stacked = spec.stacked ?? false;
  const axisValueFormatter = buildValueFormatter(spec.value_format);
  const indexAxis = spec.orientation === "horizontal" ? "y" : "x";

  return {
    responsive: true,
    maintainAspectRatio: false,
    normalized: true,
    indexAxis,
    interaction: interactive
      ? {
          mode: "nearest",
          axis: spec.type === "scatter" ? "xy" : indexAxis,
          intersect: false,
        }
      : undefined,
    animation: {
      duration: 550,
      easing: "easeOutQuart",
    },
    plugins: {
      legend: {
        display: showLegend,
        position: spec.legend_position ?? "top",
        labels: {
          color: theme.text,
          usePointStyle: true,
          boxWidth: 10,
          padding: 16,
        },
      },
      title: {
        display: Boolean(spec.title),
        text: spec.title,
        color: theme.text,
        align: "start",
        font: {
          size: 16,
          weight: 700,
        },
        padding: {
          bottom: spec.subtitle ? 4 : 16,
        },
      },
      subtitle: {
        display: Boolean(spec.subtitle),
        text: spec.subtitle,
        align: "start",
        color: theme.text,
        font: {
          size: 11,
          weight: 500,
        },
        padding: {
          bottom: 16,
        },
      },
      tooltip: {
        enabled: interactive,
        backgroundColor: spec.style_preset === "midnight" ? "rgba(248, 250, 252, 0.96)" : "rgba(23, 30, 36, 0.92)",
        titleColor: spec.style_preset === "midnight" ? "#111827" : "#F8F6F2",
        bodyColor: spec.style_preset === "midnight" ? "#111827" : "#F8F6F2",
        padding: 12,
        cornerRadius: 10,
        displayColors: true,
        callbacks: {
          label(context: { dataset: { label?: string }; parsed: { x?: number; y?: number }; raw: number }) {
            const value = spec.type === "scatter" ? context.parsed.y ?? 0 : context.raw;
            const formatted = axisValueFormatter(value);
            return context.dataset.label ? `${context.dataset.label}: ${formatted}` : formatted;
          },
        },
      },
    },
    scales:
      spec.type === "pie" || spec.type === "doughnut"
        ? undefined
        : {
            x: {
              stacked,
              title: {
                display: Boolean(spec.x_axis_label),
                text: spec.x_axis_label,
                color: theme.text,
              },
              grid: {
                display: spec.show_grid ?? false,
                color: theme.grid,
              },
              ticks: {
                color: theme.text,
                maxRotation: 0,
              },
            },
            y: {
              stacked,
              beginAtZero: true,
              title: {
                display: Boolean(spec.y_axis_label),
                text: spec.y_axis_label,
                color: theme.text,
              },
              grid: {
                display: spec.show_grid ?? true,
                color: theme.grid,
              },
              ticks: {
                color: theme.text,
                callback: axisValueFormatter,
              },
            },
          },
    elements: {
      arc: {
        borderWidth: 1.5,
        borderColor: blendWithWhite(theme.background, 0.4),
        hoverOffset: interactive ? 10 : 0,
      },
      line: {
        cubicInterpolationMode: (spec.smooth ?? (spec.type === "line")) ? "monotone" : "default",
      },
      point: {
        hitRadius: interactive ? 18 : 0,
      },
    },
  };
}

export function buildChartPlugins(spec: ClientChartSpec): Plugin[] {
  const theme = getTheme(spec);
  return [
    {
      id: "reportFoundryBackground",
      beforeDraw(chart) {
        const { ctx, width, height } = chart;
        ctx.save();
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      },
    },
    {
      id: "reportFoundryDataLabels",
      afterDatasetsDraw(chart) {
        if (!spec.show_data_labels) {
          return;
        }
        const { ctx } = chart;
        ctx.save();
        ctx.fillStyle = theme.text;
        ctx.font = "600 11px sans-serif";
        for (const meta of chart.getSortedVisibleDatasetMetas()) {
          for (let index = 0; index < meta.data.length; index += 1) {
            const element = meta.data[index];
            const value = chart.data.datasets[meta.index]?.data?.[index];
            if (typeof value !== "number") {
              continue;
            }
            ctx.textAlign = "center";
            ctx.fillText(buildValueFormatter(spec.value_format)(value), element.x, element.y - 8);
          }
        }
        ctx.restore();
      },
    },
  ];
}

export async function renderChartToDataUrl(spec: ClientChartSpec, rows: DataRow[]): Promise<string | null> {
  if (typeof document === "undefined" || rows.length === 0) {
    return null;
  }

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${HIDDEN_CHART_WIDTH}px`;
  host.style.height = `${HIDDEN_CHART_HEIGHT}px`;
  host.style.pointerEvents = "none";
  host.style.opacity = "0";

  const canvas = document.createElement("canvas");
  canvas.width = HIDDEN_CHART_WIDTH;
  canvas.height = HIDDEN_CHART_HEIGHT;
  canvas.style.width = `${HIDDEN_CHART_WIDTH}px`;
  canvas.style.height = `${HIDDEN_CHART_HEIGHT}px`;
  host.appendChild(canvas);
  document.body.appendChild(host);

  const chart = new ChartJS(
    canvas,
    {
      type: spec.type,
      data: buildChartData(spec, rows) as never,
      options: {
        ...buildChartOptions(spec),
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
      } as never,
      plugins: buildChartPlugins(spec),
    } as never,
  );

  try {
    chart.resize(HIDDEN_CHART_WIDTH, HIDDEN_CHART_HEIGHT);
    chart.update("none");
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    return canvas.toDataURL("image/png");
  } finally {
    chart.destroy();
    host.remove();
  }
}

export function getChartSurfaceStyle(spec: ClientChartSpec): { background: string; border: string } {
  const theme = getTheme(spec);
  return {
    background: theme.background,
    border: theme.grid,
  };
}

function getTheme(spec: ClientChartSpec): ChartPresetTheme {
  return PRESETS[spec.style_preset ?? "editorial"];
}

function buildSeriesColors(theme: ChartPresetTheme, count: number, seriesIndex: number): string[] {
  return Array.from({ length: count }, (_, index) => theme.palette[(index + seriesIndex) % theme.palette.length]);
}

function buildFillColor(color: string, chartType: ClientChartSpec["type"]): string {
  if (chartType === "line") {
    return `${color}20`;
  }
  return `${color}CC`;
}

function blendWithWhite(color: string, ratio: number): string {
  return blendColor(color, "#FFFFFF", ratio);
}

function blendWithBlack(color: string, ratio: number): string {
  return blendColor(color, "#000000", ratio);
}

function blendColor(from: string, to: string, ratio: number): string {
  const source = parseHexColor(from);
  const target = parseHexColor(to);
  if (!source || !target) {
    return from;
  }

  const mix = (start: number, end: number) => Math.round(start + (end - start) * ratio);
  return `rgb(${mix(source[0], target[0])}, ${mix(source[1], target[1])}, ${mix(source[2], target[2])})`;
}

function parseHexColor(color: string): [number, number, number] | null {
  const value = color.trim();
  if (!value.startsWith("#")) {
    return null;
  }

  const hex = value.slice(1);
  if (hex.length === 3) {
    return [
      Number.parseInt(hex[0] + hex[0], 16),
      Number.parseInt(hex[1] + hex[1], 16),
      Number.parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (hex.length === 6 || hex.length === 8) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

function buildValueFormatter(format: ClientChartSpec["value_format"]) {
  switch (format) {
    case "integer":
      return (value: unknown) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value ?? 0));
    case "currency":
      return (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value ?? 0));
    case "percent":
      return (value: unknown) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(Number(value ?? 0));
    case "compact":
      return (value: unknown) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value ?? 0));
    case "string":
      return (value: unknown) => String(value ?? "");
    case "number":
    default:
      return (value: unknown) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value ?? 0));
  }
}
