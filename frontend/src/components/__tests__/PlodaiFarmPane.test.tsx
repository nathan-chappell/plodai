import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppStateProvider } from "../../app/context";

const {
  createCaseMock,
  deleteCaseMock,
  getAdvisoryRecordMock,
  getCaseMock,
  listCasesMock,
  saveAdvisoryRecordMock,
  searchPlodaiEntitiesMock,
  updateCaseMock,
} = vi.hoisted(() => ({
  createCaseMock: vi.fn(),
  deleteCaseMock: vi.fn(),
  getAdvisoryRecordMock: vi.fn(),
  getCaseMock: vi.fn(),
  listCasesMock: vi.fn(),
  saveAdvisoryRecordMock: vi.fn(),
  searchPlodaiEntitiesMock: vi.fn(),
  updateCaseMock: vi.fn(),
}));

vi.mock("../ChatKitPane", () => ({
  ChatKitPane: ({ surfaceMinHeight }: { surfaceMinHeight?: number }) => (
    <div data-surface-min-height={surfaceMinHeight ?? "default"} data-testid="mock-chat-pane">
      Mock chat
    </div>
  ),
}));

vi.mock("../AuthPanel", () => ({
  AuthPanel: () => <div data-testid="mock-auth-panel">Auth</div>,
}));

vi.mock("../FarmRecordPanel", () => ({
  FarmRecordPanel: ({
    dataTestId = "mock-farm-record-panel",
    showSummarySection = true,
    showDescriptionSection = true,
  }: {
    dataTestId?: string;
    showSummarySection?: boolean;
    showDescriptionSection?: boolean;
  }) => (
    <div
      data-description-section={showDescriptionSection ? "true" : "false"}
      data-summary-section={showSummarySection ? "true" : "false"}
      data-testid={dataTestId}
    >
      {showSummarySection ? "Farm summary" : "Farm overview"}
    </div>
  ),
}));

vi.mock("../../lib/api", () => ({
  createCase: createCaseMock,
  deleteCase: deleteCaseMock,
  getAdvisoryRecord: getAdvisoryRecordMock,
  getCase: getCaseMock,
  listCases: listCasesMock,
  saveAdvisoryRecord: saveAdvisoryRecordMock,
  searchPlodaiEntities: searchPlodaiEntitiesMock,
  updateCase: updateCaseMock,
}));

import { PlodaiFarmPane } from "../PlodaiFarmPane";

const SAMPLE_FARM = {
  id: "case_1",
  title: "North Field",
  chat_id: "chat_1",
  image_count: 0,
  created_at: "2026-03-27T00:00:00Z",
  updated_at: "2026-03-27T00:00:00Z",
};

const SAMPLE_FARM_DETAIL = {
  ...SAMPLE_FARM,
  default_location: "River Road",
  profile_description: "Mixed vegetables for the spring CSA.",
  images: [],
};

const SAMPLE_FARM_RECORD = {
  version: "v2" as const,
  title: "North Field",
  profile_description: "Mixed vegetables for the spring CSA.",
  default_location: "River Road",
  subjects: [],
  reports: [],
  queries: [
    {
      id: "query_1",
      category: "input_sourcing" as const,
      question: "Where can I source CSA box materials?",
      status: "open" as const,
      source_urls: [],
      subject_ids: [],
      report_ids: [],
      measurement_ids: [],
    },
  ],
  measurements: [],
  materials: [],
};

function renderWithAppState(node: ReactNode) {
  return (
    <AppStateProvider
      value={{
        user: {
          id: "user_admin_1",
          email: "admin@example.com",
          full_name: "Admin",
          role: "admin",
          is_active: true,
          current_credit_usd: 120,
          credit_floor_usd: 0,
        },
        setUser: vi.fn(),
        authError: null,
        setAuthError: vi.fn(),
        preferredOutputLanguage: "hr",
        setPreferredOutputLanguage: vi.fn(),
      }}
    >
      {node}
    </AppStateProvider>
  );
}

describe("PlodaiFarmPane", () => {
  beforeEach(() => {
    createCaseMock.mockReset();
    deleteCaseMock.mockReset();
    getAdvisoryRecordMock.mockReset();
    getCaseMock.mockReset();
    listCasesMock.mockReset();
    saveAdvisoryRecordMock.mockReset();
    searchPlodaiEntitiesMock.mockReset();
    updateCaseMock.mockReset();

    listCasesMock.mockResolvedValue([SAMPLE_FARM]);
    getCaseMock.mockResolvedValue(SAMPLE_FARM_DETAIL);
    getAdvisoryRecordMock.mockResolvedValue({
      case_id: SAMPLE_FARM.id,
      record: SAMPLE_FARM_RECORD,
    });
    searchPlodaiEntitiesMock.mockResolvedValue({
      entities: [],
    });
  });

  it("renders advisory-case controls without orders, JSON editing, or upload chrome", () => {
    const markup = renderToStaticMarkup(renderWithAppState(<PlodaiFarmPane />));

    expect(markup).toContain("Case record");
    expect(markup).toContain("Rename");
    expect(markup).toContain("Delete case");
    expect(markup).toContain("New case");
    expect(markup).not.toContain("Orders");
    expect(markup).not.toContain("Search");
    expect(markup).not.toContain("Edit JSON");
    expect(markup).not.toContain("Edit description");
    expect(markup).not.toContain("Reply language");
    expect(markup).not.toContain("Field photos and brief");
    expect(markup).not.toContain("Upload images");
    expect(markup).not.toContain("Optional investigation brief");
  });

  it("renders compact Record/Overview/Chat panes and updates the active tab when selected", async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
    const rootElement = dom.window.document.getElementById("root");
    const scrollIntoViewMock = vi.fn();
    const matchMediaMock = vi.fn().mockImplementation(() => ({
      matches: true,
      media: "(max-width: 1180px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const globalsToOverride = {
      window: dom.window,
      document: dom.window.document,
      customElements: dom.window.customElements,
      HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
      Node: dom.window.Node,
    } as const;
    const previousDescriptors = Object.fromEntries(
      Object.keys(globalsToOverride).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );

    for (const [key, value] of Object.entries(globalsToOverride)) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }

    Object.defineProperty(dom.window, "matchMedia", {
      configurable: true,
      writable: true,
      value: matchMediaMock,
    });
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    Object.defineProperty(dom.window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoViewMock,
    });

    if (!rootElement) {
      throw new Error("Expected an advisory workspace test root.");
    }

    const root = createRoot(rootElement);

    try {
      await act(async () => {
        root.render(renderWithAppState(<PlodaiFarmPane />));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(rootElement.textContent).toContain("Record");
      expect(rootElement.textContent).toContain("Overview");
      expect(rootElement.textContent).toContain("Chat");
      expect(rootElement.querySelector("[aria-label='Open settings']")).not.toBeNull();
      expect(rootElement.textContent).toContain("HR");
      expect(rootElement.textContent).toContain("EN");
      expect(rootElement.textContent).toContain("Auth");
      expect(rootElement.textContent).not.toContain("Orders");

      const overviewTab = rootElement.querySelector("#advisory-workspace-tab-overview");
      const farmTab = rootElement.querySelector("#advisory-workspace-tab-farm");
      const chatTab = rootElement.querySelector("#advisory-workspace-tab-chat");

      expect(overviewTab?.getAttribute("aria-selected")).toBe("true");
      expect(rootElement.querySelector("[data-testid='compact-advisory-pane-track']")).not.toBeNull();
      expect(rootElement.querySelector("[data-testid='farm-management-summary']")).not.toBeNull();
      expect(rootElement.querySelector("[data-testid='mock-auth-panel']")).not.toBeNull();
      expect(rootElement.querySelector("[data-testid='mock-chat-pane']")?.getAttribute("data-surface-min-height")).toBe("500");

      await act(async () => {
        farmTab?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });

      expect(farmTab?.getAttribute("aria-selected")).toBe("true");

      await act(async () => {
        chatTab?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });

      expect(chatTab?.getAttribute("aria-selected")).toBe("true");
      expect(scrollIntoViewMock).toHaveBeenCalled();
      expect(matchMediaMock).toHaveBeenCalledWith("(max-width: 1180px)");
    } finally {
      await act(async () => {
        root.unmount();
      });
      for (const [key, descriptor] of Object.entries(previousDescriptors)) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          delete (globalThis as Record<string, unknown>)[key];
        }
      }
      dom.window.close();
    }
  });
});
