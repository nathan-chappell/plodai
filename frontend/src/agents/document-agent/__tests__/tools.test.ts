import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { createDocumentAgentClientTools } from "../tools";
import { inspectDocumentPdfBytes } from "../../../lib/pdf";
import type { AgentRuntimeContext } from "../../types";
import type { DocumentFileSummary, DocumentMergeResult } from "../../../types/stored-file";

const {
  deleteDocumentFileMock,
  fetchStoredFileBlobMock,
  listDocumentFilesMock,
  uploadStoredFileMock,
} = vi.hoisted(() => ({
  deleteDocumentFileMock: vi.fn(),
  fetchStoredFileBlobMock: vi.fn(),
  listDocumentFilesMock: vi.fn(),
  uploadStoredFileMock: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  deleteDocumentFile: deleteDocumentFileMock,
  fetchStoredFileBlob: fetchStoredFileBlobMock,
  listDocumentFiles: listDocumentFilesMock,
  uploadStoredFile: uploadStoredFileMock,
}));

function createWorkspaceContext(): AgentRuntimeContext {
  return {
    workspaceId: "workspace-1",
    workspaceName: "Documents",
    activeThreadId: "thread-1",
    agentId: "document-agent",
    agentTitle: "Documents",
    activeAgentId: "document-agent",
    selectedFileId: null,
    selectedArtifactId: null,
    currentReportArtifactId: null,
    listFiles: () => [],
    getFile: () => null,
    resolveLocalFile: async () => null,
    registerFile: async () => {
      throw new Error("registerFile not used in this test");
    },
    removeFile: async () => {
      throw new Error("removeFile not used in this test");
    },
    listArtifacts: () => [],
    getArtifact: async () => null,
    listArtifactRevisions: async () => [],
    createArtifact: async () => {
      throw new Error("createArtifact not used in this test");
    },
    applyArtifactOperation: async () => {
      throw new Error("applyArtifactOperation not used in this test");
    },
    updateWorkspace: async () => null,
  };
}

function buildDocumentFileSummary(
  options: {
    id: string;
    name: string;
    pageCount: number;
    parentFileId?: string | null;
  },
): DocumentFileSummary {
  return {
    id: options.id,
    openai_file_id: `openai-${options.id}`,
    scope: "document_thread_file",
    source_kind: "upload",
    app_id: "documents",
    workspace_id: "workspace-1",
    thread_id: "thread-1",
    attachment_id: null,
    parent_file_id: options.parentFileId ?? null,
    name: options.name,
    kind: "pdf",
    extension: "pdf",
    mime_type: "application/pdf",
    byte_size: 1024,
    status: "available",
    preview: {
      kind: "pdf",
      page_count: options.pageCount,
    },
    expires_at: null,
    created_at: "2026-03-24T00:00:00Z",
    updated_at: "2026-03-24T00:00:00Z",
  };
}

async function buildPdfPage(
  text: string,
  pageSize: [number, number] = [400, 400],
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage(pageSize);
  page.drawText(text, {
    x: 48,
    y: 320,
    size: 14,
    font,
  });
  return await document.save();
}

describe("document agent tools", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("merges document files into a derived PDF and returns explicit provenance", async () => {
    const firstBytes = await buildPdfPage("First source", [420, 420]);
    const secondBytes = await buildPdfPage("Second source", [520, 520]);
    const firstFile = buildDocumentFileSummary({
      id: "file-1",
      name: "packet.pdf",
      pageCount: 1,
    });
    const secondFile = buildDocumentFileSummary({
      id: "file-2",
      name: "appendix.pdf",
      pageCount: 1,
    });

    listDocumentFilesMock.mockResolvedValue({
      thread_id: "thread-1",
      files: [firstFile, secondFile],
    });
    fetchStoredFileBlobMock.mockImplementation(async (fileId: string) => {
      const bytes = fileId === "file-1" ? firstBytes : secondBytes;
      return new Blob([bytes], { type: "application/pdf" });
    });

    let uploadedBytes = new Uint8Array();
    uploadStoredFileMock.mockImplementation(async (params: {
      file: File;
      threadId?: string | null;
      workspaceId: string;
      parentFileId?: string | null;
      previewJson?: { kind: string; page_count?: number } | null;
    }) => {
      uploadedBytes = new Uint8Array(await params.file.arrayBuffer());
      return {
        attachment: null,
        thread_id: params.threadId ?? "thread-1",
        stored_file: buildDocumentFileSummary({
          id: "merged-file",
          name: params.file.name,
          pageCount: params.previewJson?.page_count ?? 0,
          parentFileId: params.parentFileId ?? null,
        }),
      };
    });

    const workspace = createWorkspaceContext();
    const tools = createDocumentAgentClientTools(workspace);
    const mergeTool = tools.find((tool) => tool.name === "merge_document_files");
    expect(mergeTool).toBeTruthy();

    const effects: unknown[] = [];
    const result = (await mergeTool!.handler(
      {
        sources: [{ file_id: "file-1" }, { file_id: "file-2" }],
      },
      {
        emitEffect: (effect) => effects.push(effect),
        emitEffects: (nextEffects) => effects.push(...nextEffects),
      },
    )) as DocumentMergeResult;

    expect(listDocumentFilesMock).toHaveBeenCalledOnce();
    expect(fetchStoredFileBlobMock).toHaveBeenCalledTimes(2);
    expect(uploadStoredFileMock).toHaveBeenCalledOnce();
    expect(deleteDocumentFileMock).not.toHaveBeenCalled();
    expect(effects).toEqual([]);

    const uploadCall = uploadStoredFileMock.mock.calls[0]?.[0] as {
      file: File;
      parentFileId?: string | null;
      previewJson?: { kind: string; page_count?: number } | null;
    };
    expect(uploadCall.file.name).toBe("packet__merged_2_files.pdf");
    expect(uploadCall.file.type).toBe("application/pdf");
    expect(uploadCall.parentFileId).toBe("file-1");
    expect(uploadCall.previewJson).toEqual({
      kind: "pdf",
      page_count: 2,
    });

    expect(result).toMatchObject({
      file: {
        id: "merged-file",
        name: "packet__merged_2_files.pdf",
        parent_file_id: "file-1",
      },
      source_file_ids: ["file-1", "file-2"],
      source_ranges: [
        { file_id: "file-1", start_page: 1, end_page: 1, page_count: 1 },
        { file_id: "file-2", start_page: 1, end_page: 1, page_count: 1 },
      ],
    });

    const inspection = await inspectDocumentPdfBytes(uploadedBytes, { maxPages: 2 });
    expect(inspection.pageCount).toBe(2);
    const uploadedDocument = await PDFDocument.load(uploadedBytes);
    expect(
      uploadedDocument.getPages().map((page) => page.getSize()),
    ).toEqual([
      { width: 420, height: 420 },
      { width: 520, height: 520 },
    ]);
  });

  it("appends .pdf to a provided merge output name", async () => {
    const sourceBytes = await buildPdfPage("Reusable source");
    const firstFile = buildDocumentFileSummary({
      id: "file-1",
      name: "packet.pdf",
      pageCount: 1,
    });
    const secondFile = buildDocumentFileSummary({
      id: "file-2",
      name: "appendix.pdf",
      pageCount: 1,
    });

    listDocumentFilesMock.mockResolvedValue({
      thread_id: "thread-1",
      files: [firstFile, secondFile],
    });
    fetchStoredFileBlobMock.mockResolvedValue(
      new Blob([sourceBytes], { type: "application/pdf" }),
    );
    uploadStoredFileMock.mockImplementation(async (params: {
      file: File;
      threadId?: string | null;
      parentFileId?: string | null;
    }) => ({
      attachment: null,
      thread_id: params.threadId ?? "thread-1",
      stored_file: buildDocumentFileSummary({
        id: "merged-file",
        name: params.file.name,
        pageCount: 2,
        parentFileId: params.parentFileId ?? null,
      }),
    }));

    const workspace = createWorkspaceContext();
    const tools = createDocumentAgentClientTools(workspace);
    const mergeTool = tools.find((tool) => tool.name === "merge_document_files");

    await mergeTool!.handler(
      {
        sources: [{ file_id: "file-1" }, { file_id: "file-2" }],
        output_name: "combined packet",
      },
      {
        emitEffect: () => {},
        emitEffects: () => {},
      },
    );

    const uploadCall = uploadStoredFileMock.mock.calls[0]?.[0] as { file: File };
    expect(uploadCall.file.name).toBe("combined packet.pdf");
  });
});
