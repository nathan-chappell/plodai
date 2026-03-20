import { bindClientToolsForBundle, buildCapabilityBundleForRoot } from "../../capabilities/registry";
import type {
  CapabilityBundle,
  CapabilityClientTool,
  CapabilityDemoScenario,
  CapabilityModule,
  CapabilityWorkspaceContext,
} from "../../capabilities/types";
import { buildChatKitRequestMetadata } from "../../components/ChatKitPane";
import type {
  AppThreadMetadata,
  ClientEffect,
  FeedbackOrigin,
  WorkspaceState,
} from "../../types/analysis";
import type { LocalWorkspaceFile } from "../../types/report";
import type { WorkspaceFilesystem } from "../../types/workspace";
import type { ReportSlideV1 } from "../../types/workspace-contract";
import {
  addWorkspaceFilesWithResult,
  createWorkspaceFilesystem,
  getWorkspaceContext,
  listAllWorkspaceFileNodes,
  listAllWorkspaceFiles,
} from "../workspace-fs";
import {
  buildWorkspaceStateMetadata,
  readWorkspaceReport,
} from "../workspace-contract";
import { prepareLiveTestClientToolBroker } from "./client-tool-worker";

const FEEDBACK_AGENT_PRELUDE =
  "Reply with one short acknowledgement only so there is a latest assistant response available for a feedback test. Do not open the feedback widget yet.";
const DEFAULT_LIVE_TEST_URL = "http://127.0.0.1:8000/chatkit";
const DEFAULT_LIVE_TEST_BEARER_TOKEN = "banana-for-scale";

type LiveEvent = Record<string, unknown>;

type RuntimeStateSnapshot = {
  capabilityBundle: CapabilityBundle;
  clientTools: CapabilityClientTool[];
  workspaceState: WorkspaceState;
  files: LocalWorkspaceFile[];
  filesystem: WorkspaceFilesystem;
  workspaceId: string;
  effects: ClientEffect[];
};

type RuntimeStateGetter = () => RuntimeStateSnapshot;

export type LiveToolCallSummary = {
  name: string;
  argument_keys: string[];
  payload_keys: string[];
};

export type LiveWidgetSummary = {
  copy_text: string | null;
  text_preview: string | null;
};

export type LiveErrorSummary = {
  type: string;
  code: string | null;
  message: string;
};

export type LiveEventDiagnostics = {
  event_counts: Record<string, number>;
  error_events: LiveErrorSummary[];
  final_pending_tool_names: string[];
};

export type LiveRequestMetadataSummary = {
  origin: FeedbackOrigin | null;
};

export type LiveThreadCostSnapshot = {
  scope: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

export type LiveDemoValidationReply = {
  passed: boolean;
  summary: string;
  chart_seen: boolean;
  failures: string[];
  cost_snapshot: LiveThreadCostSnapshot;
};

export type LiveWorkspaceSummary = {
  workspace_id: string;
  files: Array<{
    id: string;
    name: string;
    kind: string;
    bucket: string;
    producer_key: string;
    row_count?: number;
    page_count?: number;
    columns?: string[];
  }>;
  reports: WorkspaceState["reports"];
  current_report: {
    report_id: string;
    title: string;
    slide_count: number;
    slides: Array<{
      layout: ReportSlideV1["layout"];
      title: string;
      preview: string | null;
    }>;
  } | null;
};

export function parseLiveDemoValidationReply({
  text,
  expectChart,
  costSnapshot,
}: {
  text: string;
  expectChart: boolean;
  costSnapshot?: LiveThreadCostSnapshot;
}): LiveDemoValidationReply {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 5) {
    throw new Error("Validator reply must contain exactly 5 non-empty lines.");
  }

  const [verdictLine, summaryLine, chartLine, failuresLine, costLine] = lines;
  if (!verdictLine.startsWith("VERDICT: ")) {
    throw new Error("Validator reply must start with VERDICT.");
  }
  if (!summaryLine.startsWith("SUMMARY: ")) {
    throw new Error("Validator reply must include SUMMARY.");
  }
  if (!chartLine.startsWith("CHART_SEEN: ")) {
    throw new Error("Validator reply must include CHART_SEEN.");
  }
  if (!failuresLine.startsWith("FAILURES: ")) {
    throw new Error("Validator reply must include FAILURES.");
  }
  if (!costLine.startsWith("COST_USD: ")) {
    throw new Error("Validator reply must include COST_USD.");
  }

  const verdict = verdictLine.slice("VERDICT: ".length).trim().toUpperCase();
  const summary = summaryLine.slice("SUMMARY: ".length).trim();
  const chartDetail = chartLine.slice("CHART_SEEN: ".length).trim();
  const chart_seen = chartDetail.toUpperCase().startsWith("YES");
  const chartReason = chartDetail.replace(/^(YES|NO)\s*-\s*/i, "").trim();
  const failuresText = failuresLine.slice("FAILURES: ".length).trim();
  const failures =
    !failuresText || failuresText.toLowerCase() === "none"
      ? []
      : failuresText
          .split(";")
          .map((failure) => failure.trim())
          .filter(Boolean);
  if (expectChart && !chart_seen) {
    failures.push(`Validator did not confirm chart evidence: ${chartReason}`);
  }

  const parsedCost = Number.parseFloat(costLine.slice("COST_USD: ".length).trim());
  const cost_snapshot = costSnapshot ?? {
    scope: "before_current_turn",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: Number.isFinite(parsedCost) ? parsedCost : 0,
  };

  return {
    passed: verdict === "PASS" && failures.length === 0,
    summary,
    chart_seen,
    failures,
    cost_snapshot,
  };
}

export type LiveDeterministicChecks = {
  passed: boolean;
  failures: string[];
  assistant_text_count: number;
  widget_count: number;
  tool_call_count: number;
  error_event_count: number;
  pending_tool_count: number;
};

export type LiveDemoRunResult = {
  capabilityId: string;
  scenarioId: string;
  scenarioTitle: string;
  threadId: string;
  assistantTexts: string[];
  toolCalls: LiveToolCallSummary[];
  widgets: LiveWidgetSummary[];
  effects: ClientEffect[];
  workspaceSummary: LiveWorkspaceSummary;
  deterministicChecks: LiveDeterministicChecks;
  eventDiagnostics: LiveEventDiagnostics;
  requestMetadata: LiveRequestMetadataSummary;
};

type LiveConversationResult = {
  threadId: string;
  events: LiveEvent[];
  finalEvents: LiveEvent[];
  assistantTexts: string[];
  assistantMessages: string[];
  toolCalls: LiveToolCallSummary[];
  widgets: LiveWidgetSummary[];
  eventDiagnostics: LiveEventDiagnostics;
  requestMetadata: LiveRequestMetadataSummary;
};

type LiveConversationOptions = {
  logScope: string;
  prompts: Array<{
    text: string;
    model?: string;
  }>;
  buildMetadata: () => AppThreadMetadata;
  executeClientTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  onResponseStart?: () => void | Promise<void>;
  onResponseEnd?: () => void | Promise<void>;
  onThreadChange?: (threadId: string) => void | Promise<void>;
  initialThreadId?: string | null;
};

type FinalizeCapabilityDemoRunOptions = {
  logScope: string;
  capabilityModule: CapabilityModule;
  scenario: CapabilityDemoScenario;
  runtimeState: RuntimeStateGetter;
  conversation: LiveConversationResult;
  effects: ClientEffect[];
};

function getLiveTestConfig(): {
  chatkitUrl: string;
  bearerToken: string;
} {
  return {
    chatkitUrl: DEFAULT_LIVE_TEST_URL,
    bearerToken: DEFAULT_LIVE_TEST_BEARER_TOKEN,
  };
}

function logLiveTestStep(
  scope: string,
  step: string,
  details?: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();
  const suffix =
    details && Object.keys(details).length
      ? ` ${JSON.stringify(details)}`
      : "";
  process.stderr.write(`[chatkit-live ${timestamp}] ${scope} ${step}${suffix}\n`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildUserInput(text: string, model: string | undefined): Record<string, unknown> {
  return {
    content: [
      {
        type: "input_text",
        text,
      },
    ],
    attachments: [],
    inference_options: {
      model: model ?? "lightweight",
    },
  };
}

function buildCapabilityDemoPrompts(
  capabilityModule: CapabilityModule,
  scenario: CapabilityDemoScenario,
): Array<{
  text: string;
  model?: string;
}> {
  if (capabilityModule.definition.id === "feedback-agent") {
    return [
      { text: FEEDBACK_AGENT_PRELUDE, model: scenario.model ?? "lightweight" },
      { text: scenario.initialPrompt, model: scenario.model ?? "lightweight" },
    ];
  }

  return [{ text: scenario.initialPrompt, model: scenario.model ?? "lightweight" }];
}

function buildCapabilityInvestigationBrief(
  capabilityModule: CapabilityModule,
  scenario: CapabilityDemoScenario,
): string {
  if (capabilityModule.definition.id === "report-agent") {
    return [
      scenario.title,
      "Complete exactly one report-agent demo pass.",
      "Reuse the active report when it already exists, and only create one report if no active report is available.",
      "Use dataset_id demo-report-sales for the sales CSV work, produce exactly one grouped revenue-by-region artifact, render exactly one bar chart, append exactly one 1x2 report slide with the chart first and the summary second, then stop.",
      "After each specialist handoff, control returns to the report agent, which must check the original demo requirements again before stopping.",
      "The run is not complete until render_chart_from_file has actually happened and chart evidence is visible in the thread.",
      "A plan, inspection step, or recommendation does not count as chart completion.",
      "Do not propose optional follow-up sections, extra analysis, or additional report slides after the first completed report update.",
    ].join(" ");
  }

  if (capabilityModule.definition.id === "csv-agent") {
    return [
      scenario.title,
      "Complete exactly one csv-agent demo pass.",
      "Use dataset_id demo-sales-fixture for the grouped revenue summary work and create exactly one reusable chartable artifact from it.",
      "If you choose the chart path or produce a Chart Agent handoff, the run is not complete until render_chart_from_file has actually happened and chart evidence is visible in the thread.",
      "A plan, inspection step, or handoff widget does not count as chart completion.",
      "Do not say the chart is coming next unless the run is still actively moving toward a real render.",
    ].join(" ");
  }

  if (capabilityModule.definition.id === "feedback-agent") {
    return [
      scenario.title,
      "Complete exactly one feedback-agent demo pass.",
      "There is already a latest assistant response in the thread from the prelude turn.",
      "Open the structured feedback widget on the next turn by calling get_feedback first.",
      "Do not ask for plain-text feedback before the widget is shown.",
    ].join(" ");
  }

  return scenario.summary;
}

function buildEventCounts(events: LiveEvent[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const eventType = typeof event.type === "string" ? event.type : "unknown";
    counts.set(eventType, (counts.get(eventType) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function collectPendingToolNames(events: LiveEvent[]): string[] {
  const pendingToolNames: string[] = [];

  for (const event of events) {
    if (event.type !== "thread.item.done") {
      continue;
    }
    const item = asRecord(event.item);
    if (
      item?.type === "client_tool_call" &&
      item.status === "pending" &&
      typeof item.name === "string"
    ) {
      pendingToolNames.push(item.name);
    }
  }

  return pendingToolNames;
}

function collectErrorEvents(events: LiveEvent[]): LiveErrorSummary[] {
  return events
    .filter((event) => event.type === "error")
    .map((event) => {
      const errorRecord = asRecord(event.error);
      return {
        type: typeof event.type === "string" ? event.type : "error",
        code: stringOrNull(errorRecord?.code) ?? stringOrNull(event.code),
        message:
          stringOrNull(errorRecord?.message) ??
          stringOrNull(event.message) ??
          stringOrNull(errorRecord?.detail) ??
          stringifyUnknown(errorRecord ?? event),
      };
    });
}

function summarizeEvents(events: LiveEvent[]): Record<string, unknown> {
  return {
    event_counts: buildEventCounts(events),
    pending_tools: collectPendingToolNames(events),
    error_event_count: collectErrorEvents(events).length,
  };
}

async function postChatKitRequest(
  logScope: string,
  payload: Record<string, unknown>,
): Promise<LiveEvent[]> {
  const { chatkitUrl, bearerToken } = getLiveTestConfig();
  logLiveTestStep(logScope, "request.start", {
    type: payload.type,
  });

  let response: Response;
  try {
    response = await fetch(chatkitUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(
      `Unable to reach the ChatKit test server at ${chatkitUrl}. Start the local server before running this test. Original error: ${
        error instanceof Error ? error.message : "unknown fetch error"
      }`,
    );
  }

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      throw new Error(
        `ChatKit request failed with 401: ${body}. If you are using the local auth bypass, enable ENABLE_DEV_AUTH_BEARER=true on the backend.`,
      );
    }
    throw new Error(`ChatKit request failed with ${response.status}: ${body}`);
  }

  const body = await response.text();
  const events = body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as LiveEvent);

  logLiveTestStep(logScope, "request.done", {
    type: payload.type,
    event_count: events.length,
    ...summarizeEvents(events),
  });
  return events;
}

function findThreadId(events: LiveEvent[]): string | null {
  for (const event of events) {
    if (event.type !== "thread.created" && event.type !== "thread.updated") {
      continue;
    }
    const thread = asRecord(event.thread);
    if (typeof thread?.id === "string") {
      return thread.id;
    }
  }
  return null;
}

function findPendingClientToolCall(events: LiveEvent[]): Record<string, unknown> | null {
  for (const event of events) {
    if (event.type !== "thread.item.done") {
      continue;
    }
    const item = asRecord(event.item);
    if (item?.type === "client_tool_call" && item.status === "pending") {
      return item;
    }
  }
  return null;
}

function collectAssistantTexts(events: LiveEvent[]): string[] {
  return events
    .filter((event) => event.type === "thread.item.done")
    .map((event) => asRecord(event.item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .filter((item) => item.type === "assistant_message")
    .flatMap((item) => {
      const content = Array.isArray(item.content) ? item.content : [];
      return content
        .map((part) => {
          const contentPart = asRecord(part);
          return typeof contentPart?.text === "string" ? contentPart.text : null;
        })
        .filter((text): text is string => typeof text === "string" && text.trim().length > 0);
    });
}

function collectAssistantMessageTexts(events: LiveEvent[]): string[] {
  return events
    .filter((event) => event.type === "thread.item.done")
    .map((event) => asRecord(event.item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .filter((item) => item.type === "assistant_message")
    .map((item) => {
      const content = Array.isArray(item.content) ? item.content : [];
      return content
        .map((part) => {
          const contentPart = asRecord(part);
          return typeof contentPart?.text === "string" ? contentPart.text : null;
        })
        .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
        .join("\n")
        .trim();
    })
    .filter((text) => text.length > 0);
}

function extractWidgetTexts(value: unknown, output: string[]): void {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      output.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      extractWidgetTexts(item, output);
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const key of ["text", "value", "label"]) {
    if (typeof record[key] === "string") {
      extractWidgetTexts(record[key], output);
    }
  }
  for (const key of ["status", "children"]) {
    extractWidgetTexts(record[key], output);
  }
}

function collectWidgetSummaries(events: LiveEvent[]): LiveWidgetSummary[] {
  return events
    .filter((event) => event.type === "thread.item.done")
    .map((event) => asRecord(event.item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .filter((item) => item.type === "widget")
    .map((item) => {
      const texts: string[] = [];
      if (typeof item.copy_text === "string") {
        extractWidgetTexts(item.copy_text, texts);
      }
      extractWidgetTexts(item.widget, texts);
      const joined = texts.join(" ").replace(/\s+/g, " ").trim();
      return {
        copy_text: typeof item.copy_text === "string" ? item.copy_text : null,
        text_preview: joined ? joined.slice(0, 240) : null,
      };
    });
}

function buildEventDiagnostics(
  events: LiveEvent[],
  finalEvents: LiveEvent[],
): LiveEventDiagnostics {
  return {
    event_counts: buildEventCounts(events),
    error_events: collectErrorEvents(events),
    final_pending_tool_names: collectPendingToolNames(finalEvents),
  };
}

function buildRequestMetadataSummary(
  metadata: AppThreadMetadata | null,
): LiveRequestMetadataSummary {
  return {
    origin:
      metadata?.origin === "interactive" || metadata?.origin === "ui_integration_test"
        ? metadata.origin
        : null,
  };
}

function createMutableCapabilityWorkspace(options: {
  capabilityId: string;
  capabilityTitle: string;
  workspaceId: string;
  seedFiles: LocalWorkspaceFile[];
}): CapabilityWorkspaceContext & {
  appendFiles: (
    files: LocalWorkspaceFile[],
    source?: "demo" | "derived",
  ) => LocalWorkspaceFile[];
  getFilesystem: () => WorkspaceFilesystem;
  getWorkspaceId: () => string;
} {
  const workspaceId = options.workspaceId;
  let filesystem = addWorkspaceFilesWithResult(
    createWorkspaceFilesystem(),
    options.seedFiles,
    "demo",
    {
      bucket: "uploaded",
      producer_key: "uploaded",
      producer_label: "Uploaded",
    },
  ).filesystem;

  return {
    capabilityId: options.capabilityId,
    capabilityTitle: options.capabilityTitle,
    workspaceId,
    get files() {
      return listAllWorkspaceFiles(filesystem);
    },
    get entries() {
      return listAllWorkspaceFileNodes(filesystem);
    },
    get workspaceContext() {
      return getWorkspaceContext(filesystem, workspaceId);
    },
    updateFilesystem(updater) {
      filesystem = updater(filesystem);
    },
    getState() {
      return {
        workspaceId,
        files: listAllWorkspaceFiles(filesystem),
        entries: listAllWorkspaceFileNodes(filesystem),
        filesystem,
        workspaceContext: getWorkspaceContext(filesystem, workspaceId),
      };
    },
    appendFiles(files, source = "derived") {
      const result = addWorkspaceFilesWithResult(filesystem, files, source, {
        bucket: source === "demo" ? "uploaded" : undefined,
        producer_key: source === "demo" ? "uploaded" : options.capabilityId,
        producer_label: source === "demo" ? "Uploaded" : options.capabilityTitle,
      });
      filesystem = result.filesystem;
      return result.files;
    },
    getFilesystem() {
      return filesystem;
    },
    getWorkspaceId() {
      return workspaceId;
    },
  };
}

function buildCapabilityRuntimeGetter(
  capabilityModule: CapabilityModule,
  workspace: ReturnType<typeof createMutableCapabilityWorkspace>,
  effects: ClientEffect[],
): RuntimeStateGetter {
  return () => {
    const capabilityBundle = buildCapabilityBundleForRoot(
      capabilityModule.definition.id,
      workspace,
    );
    const clientTools = bindClientToolsForBundle(capabilityBundle, workspace);
    const state = workspace.getState();
    return {
      capabilityBundle,
      clientTools,
      workspaceState: buildWorkspaceStateMetadata(
        state.filesystem,
        state.workspaceId,
      ),
      files: state.files,
      filesystem: state.filesystem,
      workspaceId: state.workspaceId,
      effects: [...effects],
    };
  };
}

async function executeCapabilityClientTool(
  logScope: string,
  runtimeState: RuntimeStateGetter,
  workspace: ReturnType<typeof createMutableCapabilityWorkspace>,
  effects: ClientEffect[],
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = runtimeState().clientTools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Unknown client tool: ${name}`);
  }

  logLiveTestStep(logScope, "cycle.tool_call", {
    tool_name: name,
    argument_keys: Object.keys(args),
  });

  const payload = await tool.handler(args as never, {
    emitEffect(effect) {
      effects.push(effect);
    },
    emitEffects(nextEffects) {
      effects.push(...nextEffects);
    },
    appendFiles(nextFiles) {
      return workspace.appendFiles(nextFiles, "derived");
    },
  });

  logLiveTestStep(logScope, "cycle.tool_result", {
    tool_name: name,
    payload_keys: Object.keys(payload),
    effect_count: effects.length,
  });
  return payload;
}

async function runLiveChatKitConversation(
  options: LiveConversationOptions,
): Promise<LiveConversationResult> {
  getLiveTestConfig();
  const allEvents: LiveEvent[] = [];
  const toolCalls: LiveToolCallSummary[] = [];
  let threadId: string | null = options.initialThreadId ?? null;
  let finalEvents: LiveEvent[] = [];
  let lastMetadata: AppThreadMetadata | null = null;

  for (const [turnIndex, prompt] of options.prompts.entries()) {
    await options.onResponseStart?.();
    const metadata = options.buildMetadata();
    lastMetadata = metadata;
    const requestPayload = threadId
      ? {
          type: "threads.add_user_message",
          params: {
            thread_id: threadId,
            input: buildUserInput(prompt.text, prompt.model),
          },
          metadata,
        }
      : {
          type: "threads.create",
          params: {
            input: buildUserInput(prompt.text, prompt.model),
          },
          metadata,
        };

    let events = await postChatKitRequest(options.logScope, requestPayload);
    allEvents.push(...events);
    const nextThreadId: string | null = findThreadId(events) ?? threadId;
    if (!nextThreadId) {
      throw new Error("Live ChatKit run did not return a thread id.");
    }
    if (threadId !== nextThreadId) {
      threadId = nextThreadId;
      logLiveTestStep(options.logScope, "thread.ready", {
        thread_id: threadId,
        turn_index: turnIndex,
      });
      await options.onThreadChange?.(nextThreadId);
    }

    for (let cycle = 0; cycle < 12; cycle += 1) {
      const pendingToolCall = findPendingClientToolCall(events);
      if (!pendingToolCall) {
        logLiveTestStep(options.logScope, "cycle.stop", {
          turn_index: turnIndex,
          cycle,
          reason: "no_pending_client_tool_call",
        });
        break;
      }

      const toolName =
        typeof pendingToolCall.name === "string" ? pendingToolCall.name : null;
      const argumentsObject =
        pendingToolCall.arguments &&
        typeof pendingToolCall.arguments === "object" &&
        !Array.isArray(pendingToolCall.arguments)
          ? (pendingToolCall.arguments as Record<string, unknown>)
          : null;

      if (!toolName || !argumentsObject) {
        throw new Error("Pending client tool call did not include usable name/arguments.");
      }

      const toolResult = await options.executeClientTool(toolName, argumentsObject);
      const cycleMetadata = options.buildMetadata();
      lastMetadata = cycleMetadata;
      events = await postChatKitRequest(options.logScope, {
        type: "threads.add_client_tool_output",
        params: {
          thread_id: threadId,
          result: toolResult,
        },
        metadata: cycleMetadata,
      });
      allEvents.push(...events);
      toolCalls.push({
        name: toolName,
        argument_keys: Object.keys(argumentsObject),
        payload_keys: Object.keys(toolResult),
      });
    }
    finalEvents = events;
    await options.onResponseEnd?.();
  }

  if (!threadId) {
    throw new Error("Live ChatKit run never produced a thread id.");
  }

  return {
    threadId,
    events: allEvents,
    finalEvents,
    assistantTexts: collectAssistantTexts(allEvents),
    assistantMessages: collectAssistantMessageTexts(allEvents),
    toolCalls,
    widgets: collectWidgetSummaries(allEvents),
    eventDiagnostics: buildEventDiagnostics(allEvents, finalEvents),
    requestMetadata: buildRequestMetadataSummary(lastMetadata),
  };
}

function summarizeReportSlide(slide: ReportSlideV1): {
  layout: ReportSlideV1["layout"];
  title: string;
  preview: string | null;
} {
  const preview =
    slide.panels
      .map((panel) =>
        panel.type === "narrative"
          ? panel.markdown
          : JSON.stringify(panel.chart),
      )
      .join(" ")
      .slice(0, 200) || null;
  return {
    layout: slide.layout,
    title: slide.title,
    preview,
  };
}

function summarizeWorkspaceForLiveTest(
  runtimeState: RuntimeStateGetter,
): LiveWorkspaceSummary {
  const current = runtimeState();
  const currentReportId = current.workspaceState.current_report_id;
  const currentReport = currentReportId
    ? readWorkspaceReport(current.filesystem, currentReportId)
    : null;
  return {
    workspace_id: current.workspaceId,
    files: current.workspaceState.files.map((file) => ({
      id: file.id,
      name: file.name,
      kind: file.kind,
      bucket: file.bucket,
      producer_key: file.producer_key,
      row_count: file.row_count,
      page_count: file.page_count,
      columns: file.columns?.slice(0, 6),
    })),
    reports: current.workspaceState.reports,
    current_report: currentReport
      ? {
          report_id: currentReport.report_id,
          title: currentReport.title,
          slide_count: currentReport.slides.length,
          slides: currentReport.slides.slice(0, 10).map(summarizeReportSlide),
        }
      : null,
  };
}

function buildDeterministicChecks(
  assistantTexts: string[],
  widgets: LiveWidgetSummary[],
  toolCalls: LiveToolCallSummary[],
  diagnostics: LiveEventDiagnostics,
): LiveDeterministicChecks {
  const failures: string[] = [];
  if (!assistantTexts.length) {
    failures.push("No assistant response text was produced.");
  }
  if (diagnostics.final_pending_tool_names.length) {
    failures.push("A client tool call remained pending at the end of the run.");
  }
  if (diagnostics.error_events.length) {
    failures.push(
      `ChatKit returned ${diagnostics.error_events.length} error event(s): ${diagnostics.error_events
        .slice(0, 3)
        .map((errorEvent) => errorEvent.message)
        .join(" | ")}`,
    );
  }
  return {
    passed: failures.length === 0,
    failures,
    assistant_text_count: assistantTexts.length,
    widget_count: widgets.length,
    tool_call_count: toolCalls.length,
    error_event_count: diagnostics.error_events.length,
    pending_tool_count: diagnostics.final_pending_tool_names.length,
  };
}

async function finalizeCapabilityDemoRun(
  options: FinalizeCapabilityDemoRunOptions,
): Promise<LiveDemoRunResult> {
  const workspaceSummary = summarizeWorkspaceForLiveTest(options.runtimeState);
  const deterministicChecks = buildDeterministicChecks(
    options.conversation.assistantTexts,
    options.conversation.widgets,
    options.conversation.toolCalls,
    options.conversation.eventDiagnostics,
  );

  const result: LiveDemoRunResult = {
    capabilityId: options.capabilityModule.definition.id,
    scenarioId: options.scenario.id,
    scenarioTitle: options.scenario.title,
    threadId: options.conversation.threadId,
    assistantTexts: options.conversation.assistantTexts,
    toolCalls: options.conversation.toolCalls,
    widgets: options.conversation.widgets,
    effects: [...options.effects],
    workspaceSummary,
    deterministicChecks,
    eventDiagnostics: options.conversation.eventDiagnostics,
    requestMetadata: options.conversation.requestMetadata,
  };

  logLiveTestStep(options.logScope, "test.end", {
    thread_id: result.threadId,
    assistant_text_count: result.assistantTexts.length,
    tool_call_count: result.toolCalls.length,
    widget_count: result.widgets.length,
    error_event_count: result.eventDiagnostics.error_events.length,
    deterministic_passed: result.deterministicChecks.passed,
  });

  return result;
}

export async function runCapabilityDemoScenario(
  capabilityModule: CapabilityModule,
): Promise<LiveDemoRunResult> {
  const cleanupBroker = prepareLiveTestClientToolBroker();

  try {
    const scenario = await capabilityModule.buildDemoScenario();
    const logScope = capabilityModule.definition.id;
    logLiveTestStep(logScope, "test.start", {
      scenario_id: scenario.id,
      title: scenario.title,
    });

    const effects: ClientEffect[] = [];
    const workspace = createMutableCapabilityWorkspace({
      capabilityId: capabilityModule.definition.id,
      capabilityTitle: capabilityModule.definition.title,
      workspaceId: capabilityModule.definition.id,
      seedFiles: scenario.workspaceSeed,
    });
    const runtimeState = buildCapabilityRuntimeGetter(
      capabilityModule,
      workspace,
      effects,
    );
    const prompts = buildCapabilityDemoPrompts(capabilityModule, scenario);
    const investigationBrief = buildCapabilityInvestigationBrief(
      capabilityModule,
      scenario,
    );

    const conversation = await runLiveChatKitConversation({
      logScope,
      prompts,
      buildMetadata: () => {
        const current = runtimeState();
        return {
          ...buildChatKitRequestMetadata({
            capabilityBundle: current.capabilityBundle as never,
            workspaceState: current.workspaceState,
            threadOrigin: "ui_integration_test",
          }),
          investigation_brief: investigationBrief,
        };
      },
      executeClientTool: (name, args) =>
        executeCapabilityClientTool(
          logScope,
          runtimeState,
          workspace,
          effects,
          name,
          args,
        ),
    });

    return finalizeCapabilityDemoRun({
      logScope,
      capabilityModule,
      scenario,
      runtimeState,
      conversation,
      effects,
    });
  } finally {
    cleanupBroker();
  }
}
