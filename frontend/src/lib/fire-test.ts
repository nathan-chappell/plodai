import type { ClientEffect } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";

const CHATKIT_RESPONSE_TEXT_LIMIT = 200_000;
const HARNESS_RESPONSE_LIMIT = 8;
const HARNESS_EVENT_LIMIT = 50;

export type FireTestHarnessSnapshot = {
  statusEvents: Array<{
    value: string;
    recordedAt: string;
  }>;
  clientToolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    recordedAt: string;
  }>;
  effectEvents: Array<{
    name: string;
    recordedAt: string;
  }>;
  appendedFiles: Array<{
    id: string;
    name: string;
    kind: string;
    recordedAt: string;
  }>;
  threadIds: Array<{
    value: string;
    recordedAt: string;
  }>;
  chatkitResponses: Array<{
    url: string;
    status: number;
    contentType: string;
    body: string;
    markers: string[];
    recordedAt: string;
  }>;
};

type FireTestHarness = {
  reset: () => void;
  getSnapshot: () => FireTestHarnessSnapshot;
  recordStatus: (value: string) => void;
  recordClientToolCall: (name: string, args: Record<string, unknown>) => void;
  recordEffectEvent: (name: string, effect: ClientEffect | null) => void;
  recordFilesAppended: (files: LocalWorkspaceFile[]) => void;
  recordThreadId: (threadId: string) => void;
  recordChatKitResponse: (entry: {
    url: string;
    status: number;
    contentType: string;
    body: string;
  }) => void;
};

function buildInitialSnapshot(): FireTestHarnessSnapshot {
  return {
    statusEvents: [],
    clientToolCalls: [],
    effectEvents: [],
    appendedFiles: [],
    threadIds: [],
    chatkitResponses: [],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampList<T>(items: T[], limit: number): T[] {
  return items.slice(Math.max(0, items.length - limit));
}

function safeCloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function truncateBody(text: string): string {
  if (text.length <= CHATKIT_RESPONSE_TEXT_LIMIT) {
    return text;
  }
  return `${text.slice(0, CHATKIT_RESPONSE_TEXT_LIMIT)}\n...[truncated for fire test harness]`;
}

function extractMarkers(body: string): string[] {
  const markers = new Set<string>();
  const normalized = body.toLowerCase();

  if (normalized.includes('"label":"tool call"') || normalized.includes("tool requested")) {
    markers.add("tool_trace_widget");
  }
  if (normalized.includes('"label":"plan"') || normalized.includes("plan captured")) {
    markers.add("plan_widget");
  }
  if (normalized.includes("chart_rendered")) {
    markers.add("chart_rendered");
  }
  if (normalized.includes("report_section_appended")) {
    markers.add("report_section_appended");
  }
  if (normalized.includes("pdf_smart_split_completed")) {
    markers.add("pdf_smart_split_completed");
  }
  if (normalized.includes("append_report_section")) {
    markers.add("append_report_section");
  }

  return [...markers];
}

function createHarness(): FireTestHarness {
  let snapshot = buildInitialSnapshot();

  return {
    reset() {
      snapshot = buildInitialSnapshot();
    },
    getSnapshot() {
      return snapshot;
    },
    recordStatus(value: string) {
      snapshot = {
        ...snapshot,
        statusEvents: clampList(
          [...snapshot.statusEvents, { value, recordedAt: nowIso() }],
          HARNESS_EVENT_LIMIT,
        ),
      };
    },
    recordClientToolCall(name: string, args: Record<string, unknown>) {
      snapshot = {
        ...snapshot,
        clientToolCalls: clampList(
          [
            ...snapshot.clientToolCalls,
            {
              name,
              arguments: safeCloneRecord(args),
              recordedAt: nowIso(),
            },
          ],
          HARNESS_EVENT_LIMIT,
        ),
      };
    },
    recordEffectEvent(name: string, _effect: ClientEffect | null) {
      snapshot = {
        ...snapshot,
        effectEvents: clampList(
          [...snapshot.effectEvents, { name, recordedAt: nowIso() }],
          HARNESS_EVENT_LIMIT,
        ),
      };
    },
    recordFilesAppended(files: LocalWorkspaceFile[]) {
      if (!files.length) {
        return;
      }
      snapshot = {
        ...snapshot,
        appendedFiles: clampList(
          [
            ...snapshot.appendedFiles,
            ...files.map((file) => ({
              id: file.id,
              name: file.name,
              kind: file.kind,
              recordedAt: nowIso(),
            })),
          ],
          HARNESS_EVENT_LIMIT,
        ),
      };
    },
    recordThreadId(threadId: string) {
      snapshot = {
        ...snapshot,
        threadIds: clampList(
          [...snapshot.threadIds, { value: threadId, recordedAt: nowIso() }],
          HARNESS_EVENT_LIMIT,
        ),
      };
    },
    recordChatKitResponse(entry) {
      snapshot = {
        ...snapshot,
        chatkitResponses: clampList(
          [
            ...snapshot.chatkitResponses,
            {
              ...entry,
              body: truncateBody(entry.body),
              markers: extractMarkers(entry.body),
              recordedAt: nowIso(),
            },
          ],
          HARNESS_RESPONSE_LIMIT,
        ),
      };
    },
  };
}

function getHarness(): FireTestHarness | null {
  if (typeof window === "undefined") {
    return null;
  }
  const fireTestWindow = window as Window & { __fireTestHarness?: FireTestHarness };
  fireTestWindow.__fireTestHarness ??= createHarness();
  return fireTestWindow.__fireTestHarness;
}

export function resetFireTestHarness(): void {
  getHarness()?.reset();
}

export function recordFireTestStatus(value: string): void {
  getHarness()?.recordStatus(value);
}

export function recordFireTestClientToolCall(
  name: string,
  args: Record<string, unknown>,
): void {
  getHarness()?.recordClientToolCall(name, args);
}

export function recordFireTestEffectEvent(
  name: string,
  effect: ClientEffect | null,
): void {
  getHarness()?.recordEffectEvent(name, effect);
}

export function recordFireTestFilesAppended(files: LocalWorkspaceFile[]): void {
  getHarness()?.recordFilesAppended(files);
}

export function recordFireTestThreadId(threadId: string | null): void {
  if (!threadId) {
    return;
  }
  getHarness()?.recordThreadId(threadId);
}

export function recordFireTestChatKitResponse(entry: {
  url: string;
  status: number;
  contentType: string;
  body: string;
}): void {
  getHarness()?.recordChatKitResponse(entry);
}
