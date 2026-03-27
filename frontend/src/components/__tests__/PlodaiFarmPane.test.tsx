import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppStateProvider } from "../../app/context";

const {
  createFarmMock,
  deleteFarmMock,
  getFarmMock,
  getFarmRecordMock,
  listFarmsMock,
  saveFarmRecordMock,
  searchPlodaiEntitiesMock,
  updateFarmMock,
} = vi.hoisted(() => ({
  createFarmMock: vi.fn(),
  deleteFarmMock: vi.fn(),
  getFarmMock: vi.fn(),
  getFarmRecordMock: vi.fn(),
  listFarmsMock: vi.fn(),
  saveFarmRecordMock: vi.fn(),
  searchPlodaiEntitiesMock: vi.fn(),
  updateFarmMock: vi.fn(),
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
  createFarm: createFarmMock,
  deleteFarm: deleteFarmMock,
  getFarm: getFarmMock,
  getFarmRecord: getFarmRecordMock,
  listFarms: listFarmsMock,
  saveFarmRecord: saveFarmRecordMock,
  searchPlodaiEntities: searchPlodaiEntitiesMock,
  updateFarm: updateFarmMock,
}));

import { PlodaiFarmPane } from "../PlodaiFarmPane";

const SAMPLE_FARM = {
  id: "farm_1",
  name: "North Field",
  chat_id: "chat_1",
  image_count: 0,
  created_at: "2026-03-27T00:00:00Z",
  updated_at: "2026-03-27T00:00:00Z",
};

const SAMPLE_FARM_DETAIL = {
  ...SAMPLE_FARM,
  location: "River Road",
  description: "Mixed vegetables for the spring CSA.",
  images: [],
};

const SAMPLE_FARM_RECORD = {
  version: "v1" as const,
  farm_name: "North Field",
  description: "Mixed vegetables for the spring CSA.",
  location: "River Road",
  areas: [],
  crops: [],
  work_items: [],
  orders: [
    {
      id: "order_1",
      title: "CSA box",
      status: "draft" as const,
      items: [],
    },
  ],
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
    createFarmMock.mockReset();
    deleteFarmMock.mockReset();
    getFarmMock.mockReset();
    getFarmRecordMock.mockReset();
    listFarmsMock.mockReset();
    saveFarmRecordMock.mockReset();
    searchPlodaiEntitiesMock.mockReset();
    updateFarmMock.mockReset();

    listFarmsMock.mockResolvedValue([SAMPLE_FARM]);
    getFarmMock.mockResolvedValue(SAMPLE_FARM_DETAIL);
    getFarmRecordMock.mockResolvedValue({
      farm_id: SAMPLE_FARM.id,
      record: SAMPLE_FARM_RECORD,
    });
    searchPlodaiEntitiesMock.mockResolvedValue({
      entities: [],
    });
  });

  it("renders farm-scoped controls without orders, JSON editing, or upload chrome", () => {
    const markup = renderToStaticMarkup(renderWithAppState(<PlodaiFarmPane />));

    expect(markup).toContain("Farm");
    expect(markup).toContain("Rename");
    expect(markup).toContain("Delete farm");
    expect(markup).toContain("New farm");
    expect(markup).not.toContain("Orders");
    expect(markup).not.toContain("Search");
    expect(markup).not.toContain("Edit JSON");
    expect(markup).not.toContain("Edit description");
    expect(markup).not.toContain("Reply language");
    expect(markup).not.toContain("Field photos and brief");
    expect(markup).not.toContain("Upload images");
    expect(markup).not.toContain("Optional investigation brief");
  });

  it("renders compact Farm/Overview/Chat panes and updates the active tab when selected", async () => {
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
      throw new Error("Expected a farm workspace test root.");
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

      expect(rootElement.textContent).toContain("Farm");
      expect(rootElement.textContent).toContain("Overview");
      expect(rootElement.textContent).toContain("Chat");
      expect(rootElement.textContent).toContain("Admin");
      expect(rootElement.textContent).toContain("HR");
      expect(rootElement.textContent).toContain("EN");
      expect(rootElement.textContent).toContain("Auth");
      expect(rootElement.textContent).not.toContain("Orders");

      const overviewTab = rootElement.querySelector("#farm-workspace-tab-overview");
      const farmTab = rootElement.querySelector("#farm-workspace-tab-farm");
      const chatTab = rootElement.querySelector("#farm-workspace-tab-chat");

      expect(overviewTab?.getAttribute("aria-selected")).toBe("true");
      expect(rootElement.querySelector("[data-testid='compact-farm-pane-track']")).not.toBeNull();
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
