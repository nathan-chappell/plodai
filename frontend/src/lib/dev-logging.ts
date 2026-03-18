type ConsoleLike = Pick<
  Console,
  "error" | "groupCollapsed" | "groupEnd" | "info" | "warn"
>;

type ClientToolLogContext = {
  capabilityId: string;
  fileCount: number;
  threadId: string | null;
  toolName: string;
};

type ClientToolSuccessLog = ClientToolLogContext & {
  appendedFileCount: number;
  durationMs: number;
  effectCount: number;
  result: unknown;
};

type ClientToolErrorLog = ClientToolLogContext & {
  durationMs: number;
  error: unknown;
};

type ResponseLog = {
  capabilityId: string;
  fileCount: number;
  running: boolean;
  threadId: string | null;
};

type ChatKitGateLog = {
  capabilityId: string;
  clientToolCount: number;
  enabled: boolean;
  canInvestigate: boolean;
  fileCount: number;
  emptyMessage?: string;
};

type DemoStateLog = {
  capabilityId: string;
  active: boolean;
  ready: boolean;
  loading: boolean;
  fileCount?: number;
  seedCount?: number;
  demoReady?: boolean;
  error?: string | null;
  scenarioId?: string | null;
};

type WorkspaceEventLog = {
  surfaceKey: string;
  event: string;
  cwdPath?: string;
  entryCount?: number;
  fileCount?: number;
  detail?: Record<string, unknown>;
};

export type DevLogger = {
  chatKitGate: (payload: ChatKitGateLog) => void;
  clientToolError: (payload: ClientToolErrorLog) => void;
  clientToolStart: (payload: ClientToolLogContext & { args: unknown }) => void;
  clientToolSuccess: (payload: ClientToolSuccessLog) => void;
  demoState: (payload: DemoStateLog) => void;
  responseEnd: (payload: ResponseLog) => void;
  responseStart: (payload: ResponseLog) => void;
  workspaceEvent: (payload: WorkspaceEventLog) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(value).flatMap(([key, entryValue]) => {
    if (entryValue === undefined || entryValue === null) {
      return [];
    }
    if (isRecord(entryValue)) {
      const nested = compactRecord(entryValue);
      return Object.keys(nested).length ? [[key, nested] as const] : [];
    }
    return [[key, entryValue] as const];
  });
  return Object.fromEntries(entries);
}

function summarizeQueryPlan(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    datasetId: typeof value.dataset_id === "string" ? value.dataset_id : undefined,
    groupByCount: Array.isArray(value.group_by) ? value.group_by.length : undefined,
    aggregateCount: Array.isArray(value.aggregates) ? value.aggregates.length : undefined,
    filterCount: Array.isArray(value.filters) ? value.filters.length : undefined,
    limit: typeof value.limit === "number" ? value.limit : undefined,
  };
}

function summarizeChartPlan(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    chartType: typeof value.type === "string" ? value.type : undefined,
    seriesCount: Array.isArray(value.series) ? value.series.length : undefined,
  };
}

function summarizeClientToolArgs(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) {
    return { argumentType: typeof args };
  }
  return compactRecord({
    argumentKeys: summarizeKeys(args),
    datasetId: typeof args.dataset_id === "string" ? args.dataset_id : undefined,
    fileId: typeof args.file_id === "string" ? args.file_id : undefined,
    chartPlanId: typeof args.chart_plan_id === "string" ? args.chart_plan_id : undefined,
    includeSamples: typeof args.includeSamples === "boolean" ? args.includeSamples : undefined,
    maxPages: typeof args.max_pages === "number" ? args.max_pages : undefined,
    startPage: typeof args.start_page === "number" ? args.start_page : undefined,
    endPage: typeof args.end_page === "number" ? args.end_page : undefined,
    hasFilename: typeof args.filename === "string" && args.filename.length > 0 ? true : undefined,
    queryPlan: summarizeQueryPlan(args.query_plan),
    chartPlan: summarizeChartPlan(args.chart_plan),
  });
}

function summarizeClientToolResult(result: unknown): Record<string, unknown> {
  if (!isRecord(result)) {
    return { resultType: Array.isArray(result) ? "array" : typeof result };
  }
  const rows = result.rows;
  const files = result.files;
  const csvFiles = result.csv_files;
  const chartableFiles = result.chartable_files;
  const createdFile = result.created_file;
  const chart = result.chart;
  const fileInput = result.file_input;
  return compactRecord({
    resultKeys: summarizeKeys(result),
    rowCount:
      typeof result.row_count === "number"
        ? result.row_count
        : Array.isArray(rows)
          ? rows.length
          : undefined,
    filesCount: Array.isArray(files) ? files.length : undefined,
    csvFilesCount: Array.isArray(csvFiles) ? csvFiles.length : undefined,
    chartableFilesCount: Array.isArray(chartableFiles) ? chartableFiles.length : undefined,
    hasImageDataUrl:
      typeof result.imageDataUrl === "string" || typeof result.image_data_url === "string"
        ? true
        : undefined,
    createdFileKind: isRecord(createdFile) && typeof createdFile.kind === "string" ? createdFile.kind : undefined,
    chartType: isRecord(chart) && typeof chart.type === "string" ? chart.type : undefined,
    hasFileInput: isRecord(fileInput) ? true : undefined,
  });
}

function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return compactRecord({
      errorName: error.name,
      message: error.message,
    });
  }
  return compactRecord({
    errorType: typeof error,
  });
}

function buildNoopLogger(): DevLogger {
  return {
    chatKitGate() {},
    clientToolError() {},
    clientToolStart() {},
    clientToolSuccess() {},
    demoState() {},
    responseEnd() {},
    responseStart() {},
    workspaceEvent() {},
  };
}

function writeGroup(
  sink: ConsoleLike,
  level: "error" | "info" | "warn",
  label: string,
  payload: Record<string, unknown>,
): void {
  sink.groupCollapsed(label);
  sink[level](payload);
  sink.groupEnd();
}

export function createDevLogger({
  enabled,
  sink = console,
}: {
  enabled: boolean;
  sink?: ConsoleLike;
}): DevLogger {
  if (!enabled) {
    return buildNoopLogger();
  }
  return {
    chatKitGate(payload) {
      writeGroup(sink, "info", "[chatkit] gate", payload);
    },
    responseStart(payload) {
      writeGroup(sink, "info", "[chatkit] response.start", payload);
    },
    responseEnd(payload) {
      writeGroup(sink, "info", "[chatkit] response.end", payload);
    },
    clientToolStart(payload) {
      writeGroup(sink, "info", `[chatkit] client_tool.start ${payload.toolName}`, {
        capabilityId: payload.capabilityId,
        fileCount: payload.fileCount,
        threadId: payload.threadId,
        toolName: payload.toolName,
        args: summarizeClientToolArgs(payload.args),
      });
    },
    clientToolSuccess(payload) {
      writeGroup(sink, "info", `[chatkit] client_tool.success ${payload.toolName}`, {
        capabilityId: payload.capabilityId,
        fileCount: payload.fileCount,
        threadId: payload.threadId,
        toolName: payload.toolName,
        durationMs: payload.durationMs,
        effectCount: payload.effectCount,
        appendedFileCount: payload.appendedFileCount,
        result: summarizeClientToolResult(payload.result),
      });
    },
    clientToolError(payload) {
      writeGroup(sink, "warn", `[chatkit] client_tool.error ${payload.toolName}`, {
        capabilityId: payload.capabilityId,
        fileCount: payload.fileCount,
        threadId: payload.threadId,
        toolName: payload.toolName,
        durationMs: payload.durationMs,
        ...summarizeError(payload.error),
      });
    },
    demoState(payload) {
      writeGroup(sink, "info", "[demo] state", compactRecord(payload));
    },
    workspaceEvent(payload) {
      writeGroup(sink, "info", `[workspace] ${payload.event}`, compactRecord({
        surfaceKey: payload.surfaceKey,
        cwdPath: payload.cwdPath,
        fileCount: payload.fileCount,
        entryCount: payload.entryCount,
        detail: payload.detail,
      }));
    },
  };
}

export const devLogger = createDevLogger({
  enabled: import.meta.env.DEV && !import.meta.env.TEST,
});

export {
  summarizeClientToolArgs as _summarizeClientToolArgsForLog,
  summarizeClientToolResult as _summarizeClientToolResultForLog,
};
