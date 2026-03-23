// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/report-pdf", () => ({
  downloadReportPdf: vi.fn(),
}));

import { AgentPreviewPane } from "../AgentPreviewPane";
import { downloadReportPdf } from "../../lib/report-pdf";
import type { LocalImageAttachment } from "../../types/report";
import type {
  WorkspaceCreatedItemDetail,
  WorkspaceCreatedItemSummary,
  WorkspaceUploadItemSummary,
} from "../../types/workspace";
import type { WorkspaceReportV1 } from "../../types/workspace-contract";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const downloadReportPdfMock = vi.mocked(downloadReportPdf);

function buildReport(slideCount = 1): WorkspaceReportV1 {
  return {
    version: "v1",
    report_id: "report-1",
    title: "Board report",
    created_at: "2026-03-20T09:00:00.000Z",
    updated_at: "2026-03-20T10:05:00.000Z",
    slides: Array.from({ length: slideCount }, (_, index) => ({
      id: `slide-${index + 1}`,
      created_at: `2026-03-20T10:0${index}:00.000Z`,
      title: `Slide ${index + 1}`,
      layout: "1x1",
      panels: [
        {
          id: `panel-${index + 1}`,
          type: "narrative",
          title: "Summary",
          markdown: "West region revenue leads the pack.",
        },
      ],
    })),
  };
}

function buildReportArtifact(slideCount = 1): {
  summary: WorkspaceCreatedItemSummary;
  detail: WorkspaceCreatedItemDetail;
} {
  const report = buildReport(slideCount);
  const summary: WorkspaceCreatedItemSummary = {
    id: report.report_id,
    workspace_id: "workspace-default",
    kind: "report.v1",
    schema_version: "v1",
    title: report.title,
    current_revision: 2,
    created_by_user_id: "user_123",
    created_by_agent_id: "report-agent",
    last_edited_by_agent_id: "report-agent",
    summary: {
      slide_count: report.slides.length,
    },
    latest_op: "report.append_slide",
    created_at: report.created_at,
    updated_at: report.updated_at,
  };
  return {
    summary,
    detail: {
      ...summary,
      payload: report,
    },
  };
}

function buildImageSummary(): WorkspaceUploadItemSummary {
  return {
    origin: "upload",
    id: "photo-1",
    workspace_id: "workspace-default",
    name: "orchard.jpeg",
    kind: "image",
    extension: "jpeg",
    mime_type: "image/jpeg",
    byte_size: 1_572_864,
    content_key: "sha256:photo-1",
    local_status: "available",
    preview: {
      width: 1536,
      height: 2048,
    },
    created_at: "2026-03-23T11:00:00.000Z",
    updated_at: "2026-03-23T11:00:00.000Z",
  };
}

function buildLocalImage(): LocalImageAttachment {
  return {
    id: "photo-1",
    name: "orchard.jpeg",
    kind: "image",
    extension: "jpeg",
    mime_type: "image/jpeg",
    width: 1536,
    height: 2048,
    bytes_base64: "Zm9v",
    byte_size: 1_572_864,
  };
}

describe("AgentPreviewPane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    downloadReportPdfMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function renderPane(slideCount = 1) {
    const artifact = buildReportArtifact(slideCount);

    await act(async () => {
      root.render(
        <AgentPreviewPane
          files={[]}
          artifacts={[artifact.summary]}
          resolveLocalFile={async () => null}
          getArtifact={async () => artifact.detail}
          selectedItem={{ kind: "artifact", id: artifact.summary.id }}
        />,
      );
      await Promise.resolve();
    });

    return artifact;
  }

  it("exports report artifacts as direct PDF downloads", async () => {
    const artifact = await renderPane();
    downloadReportPdfMock.mockResolvedValue({
      blob: new Blob(["pdf"], { type: "application/pdf" }),
      filename: "board_report.pdf",
    });

    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Export PDF"),
    ) as HTMLButtonElement | undefined;

    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(downloadReportPdfMock).toHaveBeenCalledWith({
      files: [],
      onProgress: expect.any(Function),
      report: artifact.detail.payload,
    });
  });

  it("disables PDF export when a report has no slides", async () => {
    await renderPane(0);

    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Export PDF"),
    ) as HTMLButtonElement | undefined;

    expect(button?.disabled).toBe(true);
  });

  it("shows one report slide at a time and navigates forward", async () => {
    await renderPane(2);

    expect(container.textContent).toContain("Slide 1 of 2");
    expect(container.textContent).toContain("Slide 1");
    expect(container.textContent).not.toContain("Slide 2 of 2");

    const nextButton = container.querySelector(
      "[data-testid='report-slide-next']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      nextButton?.click();
    });

    expect(container.textContent).toContain("Slide 2 of 2");
    expect(container.textContent).toContain("Slide 2");
  });

  it("hides internal revision labels and operation names from the preview", async () => {
    await renderPane();

    expect(container.textContent).toContain("Last edited by report-agent");
    expect(container.textContent).not.toContain("Revision 2");
    expect(container.textContent).not.toContain("item.create");
    expect(container.textContent).not.toContain("report.append_slide");
  });

  it("shows the agriculture-specific empty preview treatment when nothing is selected", async () => {
    await act(async () => {
      root.render(
        <AgentPreviewPane
          appId="agriculture"
          files={[]}
          artifacts={[]}
          resolveLocalFile={async () => null}
          getArtifact={async () => null}
          selectedItem={null}
        />,
      );
    });

    expect(
      container.querySelector("[data-testid='agriculture-preview-empty']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='agriculture-preview-watermark']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Awaiting plant photos");
    expect(container.textContent).toContain("Add plant photos from the chat composer");
  });

  it("does not render the agriculture watermark for document previews", async () => {
    await act(async () => {
      root.render(
        <AgentPreviewPane
          appId="documents"
          files={[]}
          artifacts={[]}
          resolveLocalFile={async () => null}
          getArtifact={async () => null}
          selectedItem={null}
        />,
      );
    });

    expect(
      container.querySelector("[data-testid='agriculture-preview-watermark']"),
    ).toBeNull();
  });

  it("shows agriculture images as chat-linked references instead of inline previews", async () => {
    const imageSummary = buildImageSummary();
    const localImage = buildLocalImage();

    await act(async () => {
      root.render(
        <AgentPreviewPane
          appId="agriculture"
          files={[imageSummary]}
          artifacts={[]}
          resolveLocalFile={async () => localImage}
          getArtifact={async () => null}
          selectedItem={{ kind: "file", id: imageSummary.id }}
        />,
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='agriculture-preview-watermark']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='agriculture-image-reference']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Visible in chat");
    expect(container.textContent).toContain("1536 x 2048");
    expect(container.querySelector("img[alt='orchard.jpeg']")).toBeNull();
  });

  it("renders the farm artifact preview with tracked sections", async () => {
    const farmArtifact: WorkspaceCreatedItemDetail = {
      origin: "created",
      id: "farm-overview",
      workspace_id: "workspace-default",
      kind: "farm.v1",
      schema_version: "v1",
      title: "North Orchard",
      current_revision: 3,
      created_by_user_id: "user_123",
      created_by_agent_id: "agriculture-agent",
      last_edited_by_agent_id: "agriculture-agent",
      summary: {
        crop_count: 2,
        issue_count: 1,
        project_count: 1,
      },
      latest_op: "farm.set_state",
      created_at: "2026-03-23T09:00:00.000Z",
      updated_at: "2026-03-23T10:00:00.000Z",
      payload: {
        version: "v1",
        farm_name: "North Orchard",
        location: "Block A",
        crops: [
          { id: "crop_1", name: "Honeycrisp apples", area: "12 acres", expected_yield: "480 bins" },
          { id: "crop_2", name: "Cherries", area: "4 acres" },
        ],
        issues: [
          { id: "issue_1", title: "Leaf curl in row 3", status: "watching", notes: "Monitor after spray." },
        ],
        projects: [
          { id: "project_1", title: "Irrigation refresh", status: "active" },
        ],
        current_work: ["Scout block A", "Confirm irrigation timing"],
        notes: "Keep an eye on the lower canopy.",
      },
    };

    await act(async () => {
      root.render(
        <AgentPreviewPane
          appId="agriculture"
          files={[]}
          artifacts={[farmArtifact as WorkspaceCreatedItemSummary]}
          resolveLocalFile={async () => null}
          getArtifact={async () => farmArtifact}
          selectedItem={{ kind: "artifact", id: farmArtifact.id }}
        />,
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='farm-preview']")).not.toBeNull();
    expect(
      container.querySelector("[data-testid='agriculture-preview-watermark']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("North Orchard");
    expect(container.textContent).toContain("Honeycrisp apples");
    expect(container.textContent).toContain("Leaf curl in row 3");
    expect(container.textContent).toContain("Irrigation refresh");
  });
});
