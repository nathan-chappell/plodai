import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import {
  buildWorkspaceFilePayload,
  downloadWorkspaceFile,
  formatByteSize,
  openWorkspaceFileInNewTab,
} from "../lib/workspace-artifacts";
import type { ShellWorkspaceArtifact } from "../capabilities/types";
import type { LocalWorkspaceFile } from "../types/report";

const PAGE_SIZE = 8;
const JSON_PREVIEW_LIMIT = 12;
const TEXT_PREVIEW_LIMIT = 4_000;

export type CapabilityQuickViewArtifactRow = {
  kind: "artifact";
  key: string;
  artifact: ShellWorkspaceArtifact;
  depth?: number;
  label?: string;
  meta?: string;
};

export type CapabilityQuickViewFolderRow = {
  kind: "folder";
  key: string;
  label: string;
  depth?: number;
  meta?: string;
};

export type CapabilityQuickViewRow =
  | CapabilityQuickViewArtifactRow
  | CapabilityQuickViewFolderRow;

export type CapabilityQuickViewGroup = {
  key: string;
  label: string;
  rows: CapabilityQuickViewRow[];
};

type TreeFolder = {
  label: string;
  folders: Map<string, TreeFolder>;
  files: ShellWorkspaceArtifact[];
};

export type CapabilityQuickViewRenderArgs = {
  selectedArtifact: ShellWorkspaceArtifact;
  selectedRow: CapabilityQuickViewArtifactRow;
  artifactRows: CapabilityQuickViewArtifactRow[];
  currentPage: number;
  setPage: (nextPage: number) => void;
  selectArtifact: (entryId: string) => void;
};

export function summarizeQuickViewArtifactMeta(
  artifact: ShellWorkspaceArtifact,
): string {
  const file = artifact.file;
  const bits = [fileKindLabel(file)];
  if (typeof file.byte_size === "number") {
    bits.push(formatByteSize(file.byte_size));
  }
  if (file.kind === "csv" || file.kind === "json") {
    bits.push(`${file.row_count} rows`);
  }
  if (file.kind === "pdf") {
    bits.push(`${file.page_count} pages`);
  }
  return bits.join(" · ");
}

export function parseSavedChartArtifact(file: LocalWorkspaceFile): {
  title: string;
  chartPlanId: string | null;
  fileId: string | null;
  imageDataUrl: string | null;
} | null {
  if (file.kind !== "other" || !file.text_content) {
    return null;
  }
  try {
    const parsed = JSON.parse(file.text_content) as {
      title?: unknown;
      chart_plan_id?: unknown;
      file_id?: unknown;
      image_data_url?: unknown;
      chart?: unknown;
    };
    if (!parsed || typeof parsed !== "object" || !("chart" in parsed)) {
      return null;
    }
    return {
      title: typeof parsed.title === "string" ? parsed.title : file.name,
      chartPlanId:
        typeof parsed.chart_plan_id === "string"
          ? parsed.chart_plan_id
          : null,
      fileId: typeof parsed.file_id === "string" ? parsed.file_id : null,
      imageDataUrl:
        typeof parsed.image_data_url === "string"
          ? parsed.image_data_url
          : null,
    };
  } catch {
    return null;
  }
}

export function renderDefaultCapabilityQuickViewPreview({
  selectedArtifact,
  currentPage,
  setPage,
}: CapabilityQuickViewRenderArgs) {
  const file = selectedArtifact.file;
  const chartArtifact = parseSavedChartArtifact(file);

  if (chartArtifact) {
    return (
      <QuickPreviewSection>
        <QuickPreviewSectionHeader>
          <strong>Chart preview</strong>
          <MetaText>
            {chartArtifact.chartPlanId
              ? `Plan ${chartArtifact.chartPlanId}`
              : "Saved chart metadata"}
          </MetaText>
        </QuickPreviewSectionHeader>
        {chartArtifact.imageDataUrl ? (
          <QuickPreviewImage
            alt={chartArtifact.title}
            src={chartArtifact.imageDataUrl}
          />
        ) : (
          <MetaText>
            This saved chart does not have an inline image yet. Open or
            download it to inspect the full payload.
          </MetaText>
        )}
      </QuickPreviewSection>
    );
  }

  if (file.kind === "csv") {
    const previewRows = file.preview_rows.slice(
      currentPage * PAGE_SIZE,
      (currentPage + 1) * PAGE_SIZE,
    );
    const pageCount = Math.max(
      1,
      Math.ceil(file.preview_rows.length / PAGE_SIZE),
    );

    return (
      <QuickPreviewSection>
        <QuickPreviewSectionHeader>
          <strong>Table preview</strong>
          <MetaText>Showing captured preview rows for this CSV result.</MetaText>
        </QuickPreviewSectionHeader>
        <QuickPreviewMetaRow>
          <QuickPreviewMetaChip>{file.row_count} rows</QuickPreviewMetaChip>
          <QuickPreviewMetaChip>{file.columns.length} columns</QuickPreviewMetaChip>
          <QuickPreviewMetaChip>
            {file.numeric_columns.length} numeric
          </QuickPreviewMetaChip>
        </QuickPreviewMetaRow>
        <MetaText>Columns: {file.columns.join(", ")}</MetaText>
        <QuickPreviewTableScroller>
          <QuickPreviewTable>
            <thead>
              <tr>
                {file.columns.map((column) => (
                  <QuickPreviewTh key={column}>{column}</QuickPreviewTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIndex) => (
                <tr key={`${file.id}-${currentPage}-${rowIndex}`}>
                  {file.columns.map((column) => (
                    <QuickPreviewTd key={`${file.id}-${rowIndex}-${column}`}>
                      {String(row[column] ?? "")}
                    </QuickPreviewTd>
                  ))}
                </tr>
              ))}
            </tbody>
          </QuickPreviewTable>
        </QuickPreviewTableScroller>
        {pageCount > 1 ? (
          <QuickPreviewPager>
            <QuickPreviewPagerButton
              disabled={currentPage === 0}
              onClick={() => setPage(Math.max(0, currentPage - 1))}
              type="button"
            >
              Previous
            </QuickPreviewPagerButton>
            <MetaText>
              Page {currentPage + 1} of {pageCount}
            </MetaText>
            <QuickPreviewPagerButton
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
              type="button"
            >
              Next
            </QuickPreviewPagerButton>
          </QuickPreviewPager>
        ) : null}
      </QuickPreviewSection>
    );
  }

  if (file.kind === "json") {
    return (
      <QuickPreviewSection>
        <QuickPreviewSectionHeader>
          <strong>JSON preview</strong>
          <MetaText>
            Showing the first {Math.min(file.row_count, JSON_PREVIEW_LIMIT)} rows.
          </MetaText>
        </QuickPreviewSectionHeader>
        <QuickPreviewMetaRow>
          <QuickPreviewMetaChip>{file.row_count} rows</QuickPreviewMetaChip>
          <QuickPreviewMetaChip>{file.columns.length} columns</QuickPreviewMetaChip>
          <QuickPreviewMetaChip>
            {formatByteSize(file.byte_size ?? 0)}
          </QuickPreviewMetaChip>
        </QuickPreviewMetaRow>
        <QuickPreviewCode>
          {JSON.stringify(file.rows.slice(0, JSON_PREVIEW_LIMIT), null, 2)}
        </QuickPreviewCode>
      </QuickPreviewSection>
    );
  }

  if (file.kind === "pdf") {
    return (
      <QuickPreviewSection>
        <QuickPreviewSectionHeader>
          <strong>PDF summary</strong>
          <MetaText>Open this PDF in a new tab for the full document.</MetaText>
        </QuickPreviewSectionHeader>
        <QuickPreviewMetaRow>
          <QuickPreviewMetaChip>{file.page_count} pages</QuickPreviewMetaChip>
          <QuickPreviewMetaChip>
            {formatByteSize(file.byte_size ?? 0)}
          </QuickPreviewMetaChip>
        </QuickPreviewMetaRow>
      </QuickPreviewSection>
    );
  }

  if (file.text_content != null) {
    return (
      <QuickPreviewSection>
        <QuickPreviewSectionHeader>
          <strong>Text preview</strong>
          <MetaText>
            Showing the first{" "}
            {Math.min(file.text_content.length, TEXT_PREVIEW_LIMIT)} characters.
          </MetaText>
        </QuickPreviewSectionHeader>
        <QuickPreviewText>
          {file.text_content.slice(0, TEXT_PREVIEW_LIMIT)}
        </QuickPreviewText>
      </QuickPreviewSection>
    );
  }

  return (
    <QuickPreviewSection>
      <QuickPreviewSectionHeader>
        <strong>Binary file</strong>
        <MetaText>Download this file to inspect it locally.</MetaText>
      </QuickPreviewSectionHeader>
    </QuickPreviewSection>
  );
}

export function buildFolderRowsFromArtifacts(
  artifacts: ShellWorkspaceArtifact[],
  options: {
    stripPrefixes?: string[];
  } = {},
): CapabilityQuickViewRow[] {
  const root: TreeFolder = {
    label: "root",
    folders: new Map(),
    files: [],
  };

  for (const artifact of artifacts) {
    const relativeSegments = relativeArtifactSegments(
      artifact.path,
      options.stripPrefixes ?? [],
    );
    const folderSegments = relativeSegments.slice(0, -1);
    let cursor = root;
    for (const segment of folderSegments) {
      const existing = cursor.folders.get(segment);
      if (existing) {
        cursor = existing;
        continue;
      }
      const nextFolder: TreeFolder = {
        label: segment,
        folders: new Map(),
        files: [],
      };
      cursor.folders.set(segment, nextFolder);
      cursor = nextFolder;
    }
    cursor.files.push(artifact);
  }

  function flatten(
    folder: TreeFolder,
    depth: number,
    parentKey: string,
  ): CapabilityQuickViewRow[] {
    const rows: CapabilityQuickViewRow[] = [];
    const folderEntries = Array.from(folder.folders.entries()).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    for (const [folderName, childFolder] of folderEntries) {
      const key = `${parentKey}/${folderName}`;
      rows.push({
        kind: "folder",
        key,
        label: childFolder.label,
        depth,
      });
      rows.push(...flatten(childFolder, depth + 1, key));
    }
    const artifactRows = [...folder.files]
      .sort(compareArtifacts)
      .map(
        (artifact): CapabilityQuickViewArtifactRow => ({
          kind: "artifact",
          key: artifact.entryId,
          artifact,
          depth,
          meta: summarizeQuickViewArtifactMeta(artifact),
        }),
      );
    rows.push(...artifactRows);
    return rows;
  }

  return flatten(root, 0, "root");
}

export function PdfInlinePreview({
  file,
}: {
  file: LocalWorkspaceFile;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (file.kind !== "pdf") {
      setObjectUrl(null);
      setFailed(false);
      return;
    }
    try {
      const payload = buildWorkspaceFilePayload(file);
      const nextUrl = URL.createObjectURL(payload.blob);
      setObjectUrl(nextUrl);
      setFailed(false);
      return () => {
        URL.revokeObjectURL(nextUrl);
      };
    } catch {
      setObjectUrl(null);
      setFailed(true);
      return;
    }
  }, [file]);

  if (file.kind !== "pdf") {
    return null;
  }

  if (!objectUrl || failed) {
    return (
      <QuickPreviewSection>
        <QuickPreviewSectionHeader>
          <strong>PDF preview unavailable</strong>
          <MetaText>
            Open this split in a new tab to inspect the extracted pages.
          </MetaText>
        </QuickPreviewSectionHeader>
        <QuickPreviewActionButton
          onClick={() => openWorkspaceFileInNewTab(file)}
          type="button"
        >
          Open PDF
        </QuickPreviewActionButton>
      </QuickPreviewSection>
    );
  }

  return (
    <QuickPreviewSection>
      <QuickPreviewSectionHeader>
        <strong>PDF preview</strong>
        <MetaText>
          If the embed does not load cleanly, open the PDF in a new tab.
        </MetaText>
      </QuickPreviewSectionHeader>
      <QuickPreviewMetaRow>
        <QuickPreviewMetaChip>{file.page_count} pages</QuickPreviewMetaChip>
        <QuickPreviewMetaChip>
          {formatByteSize(file.byte_size ?? 0)}
        </QuickPreviewMetaChip>
      </QuickPreviewMetaRow>
      <QuickPreviewIframe
        data-testid="capability-quick-view-pdf-iframe"
        onError={() => setFailed(true)}
        src={objectUrl}
        title={file.name}
      />
      <QuickPreviewActionButton
        onClick={() => openWorkspaceFileInNewTab(file)}
        type="button"
      >
        Open PDF in new tab
      </QuickPreviewActionButton>
    </QuickPreviewSection>
  );
}

export function CapabilityQuickView({
  title,
  description,
  emptyMessage,
  groups,
  dataTestId,
  renderPreview,
}: {
  title: string;
  description: string;
  emptyMessage: string;
  groups: CapabilityQuickViewGroup[];
  dataTestId?: string;
  renderPreview?: (args: CapabilityQuickViewRenderArgs) => ReactNode;
}) {
  const artifactRows = useMemo(
    () =>
      groups.flatMap((group) =>
        group.rows.filter(
          (row): row is CapabilityQuickViewArtifactRow => row.kind === "artifact",
        ),
      ),
    [groups],
  );
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    artifactRows[0]?.artifact.entryId ?? null,
  );
  const [pageByArtifactId, setPageByArtifactId] = useState<Record<string, number>>(
    {},
  );

  useEffect(() => {
    if (!artifactRows.length) {
      setSelectedArtifactId(null);
      return;
    }
    setSelectedArtifactId((current) => {
      if (current && artifactRows.some((row) => row.artifact.entryId === current)) {
        return current;
      }
      return artifactRows[0].artifact.entryId;
    });
  }, [artifactRows]);

  const selectedRow = useMemo(
    () =>
      artifactRows.find(
        (row) => row.artifact.entryId === selectedArtifactId,
      ) ?? null,
    [artifactRows, selectedArtifactId],
  );

  const preview = selectedRow
    ? (renderPreview ?? renderDefaultCapabilityQuickViewPreview)({
        selectedArtifact: selectedRow.artifact,
        selectedRow,
        artifactRows,
        currentPage: pageByArtifactId[selectedRow.artifact.entryId] ?? 0,
        setPage: (nextPage) =>
          setPageByArtifactId((current) => ({
            ...current,
            [selectedRow.artifact.entryId]: nextPage,
          })),
        selectArtifact: setSelectedArtifactId,
      })
    : null;

  return (
    <QuickViewPanel data-testid={dataTestId}>
      <QuickViewHeader>
        <div>
          <QuickViewTitle>{title}</QuickViewTitle>
          <MetaText>{description}</MetaText>
        </div>
      </QuickViewHeader>
      <QuickViewBody>
        <QuickViewTreePane>
          {artifactRows.length ? (
            groups.map((group) => (
              <QuickViewGroup key={group.key}>
                <QuickViewGroupLabel>{group.label}</QuickViewGroupLabel>
                {group.rows.map((row) =>
                  row.kind === "folder" ? (
                    <QuickViewFolderRow
                      key={row.key}
                      style={{ paddingLeft: `${0.9 + (row.depth ?? 0) * 0.95}rem` }}
                    >
                      {row.label}
                    </QuickViewFolderRow>
                  ) : (
                    <QuickViewArtifactRow
                      key={row.key}
                      $selected={row.artifact.entryId === selectedArtifactId}
                    >
                      <QuickViewArtifactButton
                        onClick={() => setSelectedArtifactId(row.artifact.entryId)}
                        style={{ paddingLeft: `${0.9 + (row.depth ?? 0) * 0.95}rem` }}
                        type="button"
                      >
                        <QuickViewArtifactLead>
                          <QuickViewArtifactName>
                            {row.label ?? row.artifact.file.name}
                          </QuickViewArtifactName>
                          <QuickViewArtifactMeta>
                            {row.meta ?? summarizeQuickViewArtifactMeta(row.artifact)}
                          </QuickViewArtifactMeta>
                        </QuickViewArtifactLead>
                      </QuickViewArtifactButton>
                    </QuickViewArtifactRow>
                  ),
                )}
              </QuickViewGroup>
            ))
          ) : (
            <QuickViewEmptyState>{emptyMessage}</QuickViewEmptyState>
          )}
        </QuickViewTreePane>

        <QuickViewPreviewPane>
          {selectedRow ? (
            <>
              <QuickViewPreviewHeader>
                <div>
                  <QuickViewPreviewTitle>
                    {selectedRow.label ?? selectedRow.artifact.file.name}
                  </QuickViewPreviewTitle>
                  <MetaText>{selectedRow.artifact.path}</MetaText>
                </div>
                <QuickViewPreviewActions>
                  <QuickPreviewActionButton
                    onClick={() => openWorkspaceFileInNewTab(selectedRow.artifact.file)}
                    type="button"
                  >
                    Open
                  </QuickPreviewActionButton>
                  <QuickPreviewActionButton
                    onClick={() => downloadWorkspaceFile(selectedRow.artifact.file)}
                    type="button"
                  >
                    Download
                  </QuickPreviewActionButton>
                </QuickViewPreviewActions>
              </QuickViewPreviewHeader>
              {preview}
            </>
          ) : (
            <QuickViewEmptyState>{emptyMessage}</QuickViewEmptyState>
          )}
        </QuickViewPreviewPane>
      </QuickViewBody>
    </QuickViewPanel>
  );
}

function compareArtifacts(
  left: ShellWorkspaceArtifact,
  right: ShellWorkspaceArtifact,
): number {
  return (
    left.file.name.localeCompare(right.file.name) ||
    left.path.localeCompare(right.path)
  );
}

function fileKindLabel(file: LocalWorkspaceFile): string {
  switch (file.kind) {
    case "csv":
      return "csv";
    case "json":
      return "json";
    case "pdf":
      return "pdf";
    case "other":
      return file.extension || "file";
  }
}

function relativeArtifactSegments(
  path: string,
  stripPrefixes: string[],
): string[] {
  const normalizedSegments = path.split("/").filter(Boolean);
  for (const prefix of stripPrefixes) {
    const prefixSegments = prefix.split("/").filter(Boolean);
    const matchesPrefix = prefixSegments.every(
      (segment, index) => normalizedSegments[index] === segment,
    );
    if (matchesPrefix) {
      const remaining = normalizedSegments.slice(prefixSegments.length);
      return remaining.length ? remaining : normalizedSegments;
    }
  }
  return normalizedSegments;
}

const QuickViewPanel = styled.section`
  display: grid;
  gap: 0.72rem;
  min-height: 0;
`;

const QuickViewHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
`;

const QuickViewTitle = styled.h3`
  margin: 0;
  font-size: 1.05rem;
`;

const QuickViewBody = styled.div`
  display: grid;
  gap: 0.72rem;
  min-height: 0;
`;

const QuickViewTreePane = styled.section`
  min-height: 220px;
  max-height: 260px;
  overflow: auto;
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.7);
  padding: 0.78rem;
`;

const QuickViewGroup = styled.div`
  display: grid;
  gap: 0.3rem;

  & + & {
    margin-top: 0.9rem;
  }
`;

const QuickViewGroupLabel = styled.div`
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const QuickViewFolderRow = styled.div`
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.2;
`;

const QuickViewArtifactRow = styled.div<{ $selected: boolean }>`
  border-radius: var(--radius-md);
  background: ${({ $selected }) =>
    $selected ? "rgba(201, 111, 59, 0.12)" : "transparent"};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "rgba(201, 111, 59, 0.24)" : "transparent"};
`;

const QuickViewArtifactButton = styled.button`
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 0.5rem 0.45rem;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
`;

const QuickViewArtifactLead = styled.div`
  display: grid;
  gap: 0.08rem;
  min-width: 0;
`;

const QuickViewArtifactName = styled.div`
  min-width: 0;
  font-size: 0.83rem;
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const QuickViewArtifactMeta = styled(MetaText)`
  font-size: 0.72rem;
`;

const QuickViewPreviewPane = styled.section`
  min-height: 280px;
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.74);
  padding: 0.9rem;
  display: grid;
  gap: 0.7rem;
`;

const QuickViewPreviewHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
`;

const QuickViewPreviewTitle = styled.h4`
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.2;
`;

const QuickViewPreviewActions = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
`;

const QuickPreviewActionButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--ink);
  padding: 0.42rem 0.72rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
`;

const QuickViewEmptyState = styled(MetaText)`
  padding: 0.2rem 0;
`;

const QuickPreviewSection = styled.div`
  display: grid;
  gap: 0.55rem;
`;

const QuickPreviewSectionHeader = styled.div`
  display: grid;
  gap: 0.15rem;
`;

const QuickPreviewMetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
`;

const QuickPreviewMetaChip = styled.div`
  display: inline-flex;
  align-items: center;
  padding: 0.22rem 0.52rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.1);
  background: rgba(255, 255, 255, 0.82);
  font-size: 0.72rem;
  font-weight: 700;
`;

const QuickPreviewImage = styled.img`
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(250, 247, 242, 0.88);
`;

const QuickPreviewTableScroller = styled.div`
  overflow: auto;
  max-height: 260px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: var(--radius-md);
`;

const QuickPreviewTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.76rem;
`;

const QuickPreviewTh = styled.th`
  position: sticky;
  top: 0;
  padding: 0.55rem 0.65rem;
  background: rgba(252, 248, 242, 0.98);
  color: var(--ink);
  text-align: left;
  border-bottom: 1px solid rgba(31, 41, 55, 0.08);
`;

const QuickPreviewTd = styled.td`
  padding: 0.5rem 0.65rem;
  border-bottom: 1px solid rgba(31, 41, 55, 0.06);
  vertical-align: top;
`;

const QuickPreviewPager = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
`;

const QuickPreviewPagerButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  color: var(--ink);
  padding: 0.38rem 0.7rem;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.42;
  }
`;

const QuickPreviewCode = styled.pre`
  margin: 0;
  max-height: 260px;
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(20, 24, 31, 0.94);
  color: #eff8ff;
  padding: 0.8rem 0.9rem;
  font-size: 0.74rem;
  line-height: 1.45;
`;

const QuickPreviewText = styled.pre`
  margin: 0;
  max-height: 260px;
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.78);
  color: var(--ink);
  padding: 0.8rem 0.9rem;
  font-size: 0.76rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const QuickPreviewIframe = styled.iframe`
  width: 100%;
  min-height: 360px;
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.92);
`;
