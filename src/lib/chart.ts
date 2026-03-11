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
    palette: ["#C96F3B", "#497FA2", "#8F4320", "#6F8A4F", "#B69854"],
    grid: "rgba(44, 62, 80, 0.12)",
    text: "#22303C",
    accent: "#C96F3B",
    background: "rgba(255, 250, 244, 0.9)",
  },
  sunrise: {
    palette: ["#F28C54", "#E6B655", "#D45769", "#7C89C7", "#5DA5A3"],
    grid: "rgba(148, 92, 68, 0.14)",
    text: "#412A22",
    accent: "#F28C54",
    background: "rgba(255, 245, 236, 0.94)",
  },
  ocean: {
    palette: ["#2E6F95", "#4AA3A1", "#73A9D8", "#205072", "#8BC7C2"],
    grid: "rgba(32, 80, 114, 0.15)",
    text: "#173042",
    accent: "#2E6F95",
    background: "rgba(240, 249, 252, 0.94)",
  },
  forest: {
    palette: ["#496A4D", "#789B59", "#C78A3B", "#335C45", "#A2B86C"],
    grid: "rgba(51, 92, 69, 0.15)",
    text: "#203127",
    accent: "#496A4D",
    background: "rgba(244, 249, 241, 0.94)",
  },
  mono: {
    palette: ["#1F2933", "#52606D", "#7B8794", "#9AA5B1", "#CBD2D9"],
    grid: "rgba(31, 41, 51, 0.12)",
    text: "#1F2933",
    accent: "#52606D",
    background: "rgba(249, 250, 251, 0.96)",
  },
};

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
      const color = series.color ?? theme.palette[index % theme.palette.length];
      return {
        label: series.label,
        data: rows.map((row) => Number(row[series.data_key] ?? 0)),
        backgroundColor: buildFillColor(color, spec.type),
        borderColor: color,
        borderWidth: spec.type === "line" ? 3 : 1.5,
        borderRadius: spec.type === "bar" ? 10 : 0,
        borderSkipped: false,
        fill: spec.type === "line",
        tension: (spec.smooth ?? (spec.type === "line")) ? 0.35 : 0,
        pointRadius: spec.type === "line" ? 3 : 0,
        pointHoverRadius: spec.type === "line" ? 6 : 0,
        hoverBackgroundColor: color,
      };
    }),
  };
}

export function buildChartOptions(spec: ClientChartSpec) {
  const theme = getTheme(spec);
  const interactive = spec.interactive ?? true;
  const showLegend = spec.show_legend ?? spec.series.length > 1;
  const stacked = spec.stacked ?? false;

  return {
    responsive: true,
    maintainAspectRatio: false,
    normalized: true,
    interaction: interactive
      ? {
          mode: "nearest",
          axis: spec.type === "scatter" ? "xy" : "x",
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
        position: "top",
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
          bottom: 16,
        },
      },
      tooltip: {
        enabled: interactive,
        backgroundColor: "rgba(23, 30, 36, 0.92)",
        titleColor: "#F8F6F2",
        bodyColor: "#F8F6F2",
        padding: 12,
        cornerRadius: 10,
        displayColors: true,
      },
    },
    scales:
      spec.type === "pie" || spec.type === "doughnut"
        ? undefined
        : {
            x: {
              stacked,
              grid: {
                display: false,
              },
              ticks: {
                color: theme.text,
                maxRotation: 0,
              },
            },
            y: {
              stacked,
              beginAtZero: true,
              grid: {
                color: theme.grid,
              },
              ticks: {
                color: theme.text,
              },
            },
          },
    elements: {
      arc: {
        borderWidth: 0,
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

function buildFillColor(color: string, chartType: ClientChartSpec["type"]): string {
  if (chartType === "line") {
    return `${color}20`;
  }
  return color;
}
