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
  ExecutionMode,
  FeedbackOrigin,
  WorkspaceState,
} from "../../types/analysis";
import type { LocalWorkspaceFile } from "../../types/report";
import type { WorkspaceFilesystem } from "../../types/workspace";
import type { ReportItemV1 } from "../../types/workspace-contract";
import {
  addWorkspaceFilesWithResult,
  createWorkspaceFilesystem,
  getWorkspaceContext,
  listDirectoryEntries,
  listDirectoryFiles,
  normalizePathPrefix,
} from "../workspace-fs";
import { buildWorkspaceStateMetadata, readWorkspaceReport } from "../workspace-contract";
import { prepareLiveTestClientToolBroker } from "./client-tool-worker";

const FEEDBACK_AGENT_PRELUDE =
  "Reply with one short acknowledgement only so there is a latest assistant response available for a feedback test. Do not open the feedback widget yet.";
const DEFAULT_LIVE_TEST_URL = "http://127.0.0.1:8000/chatkit";
const DEFAULT_LIVE_TEST_BEARER_TOKEN = "banana-for-scale";
const DEMO_VALIDATOR_CAPABILITY_ID = "demo-validator-agent";
const DEMO_VALIDATOR_COST_SNAPSHOT_METADATA_KEY = "demo_validator_cost_snapshot";
const DEMO_VALIDATOR_COST_SNAPSHOT_PROGRESS_PREFIX = "DEMO_VALIDATOR_COST_SNAPSHOT ";

type LiveEvent = Record<string, unknown>;

type RuntimeStateSnapshot = {
  capabilityBundle: CapabilityBundle;
  clientTools: CapabilityClientTool[];
  workspaceState: WorkspaceState;
  executionMode: ExecutionMode;
  files: LocalWorkspaceFile[];
  filesystem: WorkspaceFilesystem;
  activePrefix: string;
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
  execution_mode: ExecutionMode | null;
};

export type LiveWorkspaceSummary = {
  active_prefix: string;
  files: Array<{
    id: string;
    name: string;
    kind: string;
    path: string;
    row_count?: number;
    page_count?: number;
    columns?: string[];
  }>;
  reports: WorkspaceState["reports"];
  current_report: {
    report_id: string;
    title: string;
    item_count: number;
    items: Array<{
      type: ReportItemV1["type"];
      title: string;
      preview: string | null;
    }>;
  } | null;
};

export type LiveDeterministicChecks = {
  passed: boolean;
  failures: string[];
  assistant_text_count: number;
  widget_count: number;
  tool_call_count: number;
  error_event_count: number;
  pending_tool_count: number;
};

export type LiveThreadCostSnapshot = {
  scope: "before_current_turn";
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

export type LiveDemoValidation = {
  passed: boolean;
  summary: string;
  failures: string[];
  chart_seen: boolean;
  cost_snapshot: LiveThreadCostSnapshot;
  raw_text: string;
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
  validation: LiveDemoValidation;
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
  validation: LiveDemoValidation;
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
      "Create or reuse the active report, use dataset_id demo-report-sales for the sales CSV work, produce the grouped revenue-by-region artifact, render one bar chart, append exactly one report item, then stop.",
      "After each specialist handoff, control returns to the report agent, which must check the original demo requirements again before stopping.",
      "The run is not complete until render_chart_from_file has actually happened and chart evidence is visible in the thread.",
      "A plan, inspection step, or recommendation does not count as chart completion.",
      "Do not propose optional follow-up sections, extra analysis, or additional report items after the first completed report update.",
    ].join(" ");
  }

  return scenario.summary;
}

function buildDemoValidatorCapabilityBundle(): CapabilityBundle {
  return {
    root_capability_id: DEMO_VALIDATOR_CAPABILITY_ID,
    capabilities: [
      {
        capability_id: DEMO_VALIDATOR_CAPABILITY_ID,
        agent_name: "Demo Validator",
        instructions: [
          "You are the hidden validator for a completed live capability demo.",
          "This turn is validation only. Do not continue the work, do not suggest next steps, and do not ask follow-up questions.",
          "Use the existing same-thread conversation context to judge whether the demo actually completed the requested work.",
          "If chart or image evidence is present in the thread, only answer CHART_SEEN: YES when you genuinely observed that evidence in the conversation context.",
          "You have exactly one pricing tool: get_current_thread_cost.",
          "Call get_current_thread_cost exactly once before your final answer.",
          "Copy usage.cost_usd from that tool result verbatim into COST_USD.",
          "Never invent, estimate, round differently, or substitute a fallback price.",
          "If you skip the pricing tool, your answer is invalid.",
          "Return exactly five lines and nothing else in this format:",
          "VERDICT: PASS|FAIL",
          "SUMMARY: ...",
          "CHART_SEEN: YES|NO - ...",
          "FAILURES: none | item 1 ; item 2",
          "COST_USD: <decimal>",
        ].join(" "),
        client_tools: [],
        handoff_targets: [],
      },
    ],
  };
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
  const executionMode = metadata?.execution_mode;
  return {
    origin:
      metadata?.origin === "interactive" || metadata?.origin === "ui_integration_test"
        ? metadata.origin
        : null,
    execution_mode:
      executionMode === "interactive" || executionMode === "batch"
        ? executionMode
        : null,
  };
}

function createMutableCapabilityWorkspace(options: {
  activePrefix: string;
  seedFiles: LocalWorkspaceFile[];
}): CapabilityWorkspaceContext & {
  appendFiles: (
    files: LocalWorkspaceFile[],
    source?: "demo" | "derived",
  ) => LocalWorkspaceFile[];
  getFilesystem: () => WorkspaceFilesystem;
  getActivePrefix: () => string;
} {
  let activePrefix = normalizePathPrefix(options.activePrefix);
  let filesystem = addWorkspaceFilesWithResult(
    createWorkspaceFilesystem(),
    activePrefix,
    options.seedFiles,
    "demo",
  ).filesystem;

  return {
    get activePrefix() {
      return activePrefix;
    },
    get cwdPath() {
      return activePrefix;
    },
    get files() {
      return listDirectoryFiles(filesystem, activePrefix);
    },
    get entries() {
      return listDirectoryEntries(filesystem, activePrefix);
    },
    get workspaceContext() {
      return getWorkspaceContext(filesystem, activePrefix);
    },
    setActivePrefix(prefix) {
      activePrefix = normalizePathPrefix(prefix);
    },
    createDirectory(path) {
      return path;
    },
    changeDirectory(path) {
      return path;
    },
    updateFilesystem(updater) {
      filesystem = updater(filesystem);
    },
    getState() {
      return {
        activePrefix,
        cwdPath: activePrefix,
        files: listDirectoryFiles(filesystem, activePrefix),
        entries: listDirectoryEntries(filesystem, activePrefix),
        filesystem,
        workspaceContext: getWorkspaceContext(filesystem, activePrefix),
      };
    },
    appendFiles(files, source = "derived") {
      const result = addWorkspaceFilesWithResult(filesystem, activePrefix, files, source);
      filesystem = result.filesystem;
      return result.files;
    },
    getFilesystem() {
      return filesystem;
    },
    getActivePrefix() {
      return activePrefix;
    },
  };
}

function buildCapabilityRuntimeGetter(
  capabilityModule: CapabilityModule,
  workspace: ReturnType<typeof createMutableCapabilityWorkspace>,
  effects: ClientEffect[],
  executionMode: ExecutionMode,
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
        state.activePrefix,
      ),
      executionMode,
      files: state.files,
      filesystem: state.filesystem,
      activePrefix: state.activePrefix,
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

function summarizeReportItem(item: ReportItemV1): {
  type: ReportItemV1["type"];
  title: string;
  preview: string | null;
} {
  if (item.type === "section") {
    return {
      type: item.type,
      title: item.title,
      preview: item.markdown.slice(0, 200),
    };
  }
  if (item.type === "note") {
    return {
      type: item.type,
      title: item.title,
      preview: item.text.slice(0, 200),
    };
  }
  if (item.type === "chart") {
    return {
      type: item.type,
      title: item.title,
      preview: JSON.stringify(item.chart).slice(0, 200),
    };
  }
  if (item.type === "pdf_split") {
    return {
      type: item.type,
      title: item.source_file_name,
      preview: item.markdown.slice(0, 200),
    };
  }
  return {
    type: item.type,
    title: item.title,
    preview: JSON.stringify(item.payload).slice(0, 200),
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
    active_prefix: current.activePrefix,
    files: current.workspaceState.files.map((file) => ({
      id: file.id,
      name: file.name,
      kind: file.kind,
      path: file.path,
      row_count: file.row_count,
      page_count: file.page_count,
      columns: file.columns?.slice(0, 6),
    })),
    reports: current.workspaceState.reports,
    current_report: currentReport
      ? {
          report_id: currentReport.report_id,
          title: currentReport.title,
          item_count: currentReport.items.length,
          items: currentReport.items.slice(0, 10).map(summarizeReportItem),
        }
      : null,
  };
}

function normalizeLiveThreadCostSnapshot(value: unknown): LiveThreadCostSnapshot | null {
  const record = asRecord(value);
  const usage = asRecord(record?.usage);
  const inputTokens = numberOrNull(usage?.input_tokens);
  const outputTokens = numberOrNull(usage?.output_tokens);
  const costUsd = numberOrNull(usage?.cost_usd);
  if (
    record?.scope !== "before_current_turn" ||
    inputTokens === null ||
    outputTokens === null ||
    costUsd === null
  ) {
    return null;
  }
  return {
    scope: "before_current_turn",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
  };
}

function findLiveDemoValidatorCostSnapshot(events: LiveEvent[]): LiveThreadCostSnapshot | null {
  for (const event of [...events].reverse()) {
    if (
      event.type === "progress_update" &&
      typeof event.text === "string" &&
      event.text.startsWith(DEMO_VALIDATOR_COST_SNAPSHOT_PROGRESS_PREFIX)
    ) {
      const rawSnapshot = event.text
        .slice(DEMO_VALIDATOR_COST_SNAPSHOT_PROGRESS_PREFIX.length)
        .trim();
      try {
        const snapshot = normalizeLiveThreadCostSnapshot(JSON.parse(rawSnapshot));
        if (snapshot) {
          return snapshot;
        }
      } catch {
        // Ignore malformed progress payloads and keep scanning.
      }
    }
    if (event.type !== "thread.updated" && event.type !== "thread.created") {
      continue;
    }
    const thread = asRecord(event.thread);
    const metadata = asRecord(thread?.metadata);
    const snapshot = normalizeLiveThreadCostSnapshot(
      metadata?.[DEMO_VALIDATOR_COST_SNAPSHOT_METADATA_KEY],
    );
    if (snapshot) {
      return snapshot;
    }
  }
  return null;
}

function formatValidationFileSummary(workspaceSummary: LiveWorkspaceSummary): string {
  if (!workspaceSummary.files.length) {
    return "none";
  }
  return workspaceSummary.files
    .slice(0, 8)
    .map((file) => `${file.name} (${file.kind})`)
    .join(", ");
}

function formatValidationReportSummary(workspaceSummary: LiveWorkspaceSummary): string {
  const currentReport = workspaceSummary.current_report;
  if (!currentReport) {
    return `reports=${workspaceSummary.reports.length}; current=none`;
  }
  const itemTitles =
    currentReport.items.map((item) => item.title).filter((title) => title.trim().length > 0).join(", ") ||
    "untitled";
  return `reports=${workspaceSummary.reports.length}; current=${currentReport.title}; items=${currentReport.item_count}; item_titles=${itemTitles}`;
}

function buildLiveDemoValidationPrompt(options: {
  scenario: CapabilityDemoScenario;
  conversation: LiveConversationResult;
  effects: ClientEffect[];
  workspaceSummary: LiveWorkspaceSummary;
}): string {
  const toolNames = [...new Set(options.conversation.toolCalls.map((toolCall) => toolCall.name))];
  const chartEffectPresent = options.effects.some((effect) => effect.type === "chart_rendered");
  const expectedOutcomes =
    options.scenario.expectedOutcomes && options.scenario.expectedOutcomes.length > 0
      ? options.scenario.expectedOutcomes.join(" | ")
      : "No explicit expected outcomes were provided.";
  const finalAssistantPreview =
    options.conversation.assistantMessages.at(-1)?.replace(/\s+/g, " ").trim().slice(0, 240) ??
    "none";

  return [
    "Analyze the already-completed demo run in this same thread.",
    "This is validation only. Do not continue the task, do not add more analysis work, and do not offer next steps.",
    "Use the full same-thread conversation context, including any attached chart or image evidence already visible in the thread.",
    "You have exactly one pricing tool available: get_current_thread_cost.",
    "Call get_current_thread_cost exactly once before answering, then copy usage.cost_usd from that tool result verbatim into COST_USD.",
    "Do not estimate, round differently, or substitute 0 unless the tool itself returned 0.",
    "If you skip the tool call, your answer is invalid.",
    "Price is part of the assessment, not an optional extra.",
    "",
    `SCENARIO_TITLE: ${options.scenario.title}`,
    `SCENARIO_SUMMARY: ${options.scenario.summary}`,
    `EXPECTED_OUTCOMES: ${expectedOutcomes}`,
    "",
    "RUN_SUMMARY:",
    `tool_names: ${toolNames.join(", ") || "none"}`,
    `effect_count: ${options.effects.length}`,
    `chart_effect_present: ${chartEffectPresent ? "yes" : "no"}`,
    `file_summary: ${formatValidationFileSummary(options.workspaceSummary)}`,
    `report_summary: ${formatValidationReportSummary(options.workspaceSummary)}`,
    `final_assistant_preview: ${finalAssistantPreview}`,
    "",
    "Return exactly these five lines and nothing else:",
    "VERDICT: PASS|FAIL",
    "SUMMARY: ...",
    "CHART_SEEN: YES|NO - ...",
    "FAILURES: none | item 1 ; item 2",
    "COST_USD: <decimal>",
  ].join("\n");
}

export function parseLiveDemoValidationReply(options: {
  text: string;
  expectChart: boolean;
  costSnapshot?: LiveThreadCostSnapshot | null;
}): LiveDemoValidation {
  const normalizedText = options.text.trim();
  const lines = normalizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length !== 5) {
    throw new Error(
      `Validator reply must contain exactly 5 non-empty lines, received ${lines.length}. Raw reply: ${normalizedText || "<empty>"}`,
    );
  }

  const verdictMatch = /^VERDICT:\s*(PASS|FAIL)$/i.exec(lines[0]);
  const summaryMatch = /^SUMMARY:\s*(.+)$/i.exec(lines[1]);
  const chartMatch = /^CHART_SEEN:\s*(YES|NO)\s*-\s*(.+)$/i.exec(lines[2]);
  const failuresMatch = /^FAILURES:\s*(.+)$/i.exec(lines[3]);
  const costMatch = /^COST_USD:\s*(-?\d+(?:\.\d+)?)$/i.exec(lines[4]);

  if (!verdictMatch || !summaryMatch || !chartMatch || !failuresMatch || !costMatch) {
    throw new Error(`Validator reply did not match the required contract. Raw reply: ${normalizedText}`);
  }

  const verdict = verdictMatch[1].toUpperCase();
  const summary = summaryMatch[1].trim();
  const chartSeen = chartMatch[1].toUpperCase() === "YES";
  const chartRationale = chartMatch[2].trim();
  const rawFailures = failuresMatch[1].trim();
  const reportedCostUsd = Number(costMatch[1]);
  if (!Number.isFinite(reportedCostUsd)) {
    throw new Error(`Validator reply included an invalid COST_USD value. Raw reply: ${normalizedText}`);
  }
  const costSnapshot =
    options.costSnapshot ??
    ({
      scope: "before_current_turn",
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: reportedCostUsd,
    } satisfies LiveThreadCostSnapshot);
  if (
    options.costSnapshot &&
    Math.abs(reportedCostUsd - options.costSnapshot.cost_usd) > 0.00000001
  ) {
    throw new Error(
      `Validator COST_USD ${reportedCostUsd} did not match expected pre-validation snapshot ${options.costSnapshot.cost_usd}. Raw reply: ${normalizedText}`,
    );
  }

  const failures =
    rawFailures.toLowerCase() === "none"
      ? []
      : rawFailures
          .split(";")
          .map((failure) => failure.trim())
          .filter((failure) => failure.length > 0);

  if (verdict === "FAIL" && failures.length === 0) {
    failures.push("Validator returned FAIL without any listed failure reasons.");
  }
  if (options.expectChart && !chartSeen) {
    failures.push(`Validator did not confirm chart evidence: ${chartRationale}`);
  }
  if (verdict === "PASS" && rawFailures.toLowerCase() !== "none") {
    failures.push("Validator returned PASS but also reported failures.");
  }

  return {
    passed: verdict === "PASS" && failures.length === 0,
    summary,
    failures,
    chart_seen: chartSeen,
    cost_snapshot: costSnapshot,
    raw_text: normalizedText,
  };
}

function assertLiveDemoValidationPassed(validation: LiveDemoValidation): void {
  if (validation.passed) {
    return;
  }
  throw new Error(
    [
      "Live demo validation failed.",
      `Summary: ${validation.summary}`,
      `Failures: ${validation.failures.join(" | ") || "none provided"}`,
      `Raw reply: ${validation.raw_text || "<empty>"}`,
    ].join("\n"),
  );
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

async function runLiveDemoValidation(options: {
  logScope: string;
  scenario: CapabilityDemoScenario;
  threadId: string;
  runtimeState: RuntimeStateGetter;
  mainConversation: LiveConversationResult;
  effects: ClientEffect[];
}): Promise<LiveDemoValidation> {
  const workspaceSummary = summarizeWorkspaceForLiveTest(options.runtimeState);
  const validatorBundle = buildDemoValidatorCapabilityBundle();
  const validationConversation = await runLiveChatKitConversation({
    logScope: `${options.logScope}:validator`,
    prompts: [
      {
        text: buildLiveDemoValidationPrompt({
          scenario: options.scenario,
          conversation: options.mainConversation,
          effects: options.effects,
          workspaceSummary,
        }),
        model: options.scenario.model ?? "lightweight",
      },
    ],
    initialThreadId: options.threadId,
    buildMetadata: () => {
      const current = options.runtimeState();
      return {
        ...buildChatKitRequestMetadata({
          capabilityBundle: validatorBundle as never,
          workspaceState: current.workspaceState,
          threadOrigin: "ui_integration_test",
          executionMode: current.executionMode,
        }),
      };
    },
    executeClientTool: async (name) => {
      throw new Error(`Validator should not request client tools, received ${name}.`);
    },
  });

  if (validationConversation.eventDiagnostics.error_events.length > 0) {
    throw new Error(
      `Validator turn emitted ChatKit errors: ${validationConversation.eventDiagnostics.error_events
        .map((errorEvent) => errorEvent.message)
        .join(" | ")}`,
    );
  }

  const validatorReply = validationConversation.assistantMessages.at(-1);
  if (!validatorReply) {
    throw new Error("Validator turn did not produce a final assistant reply.");
  }

  const costSnapshot = findLiveDemoValidatorCostSnapshot(validationConversation.events);
  const validation = parseLiveDemoValidationReply({
    text: validatorReply,
    expectChart: options.effects.some((effect) => effect.type === "chart_rendered"),
    costSnapshot,
  });
  assertLiveDemoValidationPassed(validation);
  return validation;
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
    validation: options.validation,
  };

  logLiveTestStep(options.logScope, "test.end", {
    thread_id: result.threadId,
    assistant_text_count: result.assistantTexts.length,
    tool_call_count: result.toolCalls.length,
    widget_count: result.widgets.length,
    error_event_count: result.eventDiagnostics.error_events.length,
    deterministic_passed: result.deterministicChecks.passed,
    validation_passed: result.validation.passed,
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
    const executionMode = scenario.defaultExecutionMode ?? "batch";
    const workspace = createMutableCapabilityWorkspace({
      activePrefix: `/${capabilityModule.definition.id}/`,
      seedFiles: scenario.workspaceSeed,
    });
    const runtimeState = buildCapabilityRuntimeGetter(
      capabilityModule,
      workspace,
      effects,
      executionMode,
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
            executionMode: current.executionMode,
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
    const validation = await runLiveDemoValidation({
      logScope,
      scenario,
      threadId: conversation.threadId,
      runtimeState,
      mainConversation: conversation,
      effects,
    });

    return finalizeCapabilityDemoRun({
      logScope,
      capabilityModule,
      scenario,
      runtimeState,
      conversation,
      effects,
      validation,
    });
  } finally {
    cleanupBroker();
  }
}
