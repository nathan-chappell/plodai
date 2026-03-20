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

export type CapabilityQuickViewFact = {
  key: string;
  value: string;
};

function pluralize(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function quickViewFileKindLabel(file: LocalWorkspaceFile): string {
  switch (file.kind) {
    case "csv":
      return "CSV";
    case "json":
      return "JSON";
    case "pdf":
      return "PDF";
    case "other":
      return file.extension ? `${file.extension.toUpperCase()} file` : "File";
  }
}

function artifactSourceLabel(
  source: ShellWorkspaceArtifact["source"],
): string {
  switch (source) {
    case "uploaded":
      return "Uploaded file";
    case "derived":
      return "Derived artifact";
    case "demo":
      return "Demo artifact";
  }
}

function dedupeCapabilityQuickViewFacts(
  facts: CapabilityQuickViewFact[],
): CapabilityQuickViewFact[] {
  const seen = new Set<string>();
  const deduped: CapabilityQuickViewFact[] = [];
  for (const fact of facts) {
    const value = fact.value.trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({ ...fact, value });
  }
  return deduped;
}

export function buildCapabilityQuickViewFacts(
  artifact: ShellWorkspaceArtifact,
  options: {
    extraFacts?: CapabilityQuickViewFact[];
    includeSource?: boolean;
  } = {},
): CapabilityQuickViewFact[] {
  const file = artifact.file;
  const chartArtifact = parseSavedChartArtifact(file);
  const facts: CapabilityQuickViewFact[] = [
    {
      key: "kind",
      value: chartArtifact ? "Saved chart" : quickViewFileKindLabel(file),
    },
  ];

  if (typeof file.byte_size === "number") {
    facts.push({ key: "size", value: formatByteSize(file.byte_size) });
  }

  if (file.kind === "csv" || file.kind === "json") {
    facts.push({ key: "rows", value: pluralize(file.row_count, "row") });
    facts.push({
      key: "columns",
      value: pluralize(file.columns.length, "column"),
    });
  }

  if (file.kind === "pdf") {
    facts.push({ key: "pages", value: pluralize(file.page_count, "page") });
  }

  if (options.extraFacts?.length) {
    facts.push(...options.extraFacts);
  }

  if (options.includeSource ?? true) {
    facts.push({ key: "source", value: artifactSourceLabel(artifact.source) });
  }

  return dedupeCapabilityQuickViewFacts(facts);
}

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
        <MetaText>
          Showing the first {Math.min(file.row_count, JSON_PREVIEW_LIMIT)} rows.
        </MetaText>
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
          <strong>PDF preview</strong>
          <MetaText>Open this PDF in a new tab for the full document.</MetaText>
        </QuickPreviewSectionHeader>
      </QuickPreviewSection>
    );
  }

  if (file.text_content != null) {
    return (
      <QuickPreviewSection>
        <MetaText>
          Showing the first{" "}
          {Math.min(file.text_content.length, TEXT_PREVIEW_LIMIT)} characters.
        </MetaText>
        <QuickPreviewText>
          {file.text_content.slice(0, TEXT_PREVIEW_LIMIT)}
        </QuickPreviewText>
      </QuickPreviewSection>
    );
  }

  return (
    <QuickPreviewSection>
      <QuickPreviewSectionHeader>
        <strong>Preview unavailable</strong>
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
  void options;

  const groupEntries = new Map<string, ShellWorkspaceArtifact[]>();
  for (const artifact of artifacts) {
    const key = `${artifact.bucket}:${artifact.producerKey}`;
    const current = groupEntries.get(key) ?? [];
    current.push(artifact);
    groupEntries.set(key, current);
  }

  const groups = Array.from(groupEntries.entries()).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  const showGroupHeaders = groups.length > 1;
  const rows: CapabilityQuickViewRow[] = [];

  for (const [groupKey, groupArtifacts] of groups) {
    if (showGroupHeaders) {
      const [bucket, producerKey] = groupKey.split(":");
      const leadArtifact = groupArtifacts[0];
      rows.push({
        kind: "folder",
        key: `${groupKey}:header`,
        label: `${leadArtifact.producerLabel} · ${bucketLabel(bucket)}`,
        meta: producerKey,
      });
    }
    rows.push(
      ...groupArtifacts.sort(compareArtifacts).map(
        (artifact): CapabilityQuickViewArtifactRow => ({
          kind: "artifact",
          key: artifact.entryId,
          artifact,
          depth: showGroupHeaders ? 1 : 0,
          meta: summarizeQuickViewArtifactMeta(artifact),
        }),
      ),
    );
  }

  return rows;
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
      </QuickPreviewSection>
    );
  }

  return (
    <QuickPreviewSection>
      <QuickPreviewSectionHeader>
        <strong>PDF preview</strong>
        <MetaText>
          If the embed does not load cleanly, open the PDF in a new tab.{" "}
          <QuickPreviewInlineMeta>
            {file.page_count} pages · {formatByteSize(file.byte_size ?? 0)}
          </QuickPreviewInlineMeta>
        </MetaText>
      </QuickPreviewSectionHeader>
      <QuickPreviewIframe
        data-testid="capability-quick-view-pdf-iframe"
        onError={() => setFailed(true)}
        src={objectUrl}
        title={file.name}
      />
    </QuickPreviewSection>
  );
}

export function CapabilityQuickView({
  emptyMessage,
  groups,
  dataTestId,
  renderPreview,
  buildPreviewFacts,
}: {
  emptyMessage: string;
  groups: CapabilityQuickViewGroup[];
  dataTestId?: string;
  renderPreview?: (args: CapabilityQuickViewRenderArgs) => ReactNode;
  buildPreviewFacts?: (
    artifact: ShellWorkspaceArtifact,
  ) => CapabilityQuickViewFact[];
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
  const previewFacts = selectedRow
    ? dedupeCapabilityQuickViewFacts(
        buildPreviewFacts
          ? buildPreviewFacts(selectedRow.artifact)
          : buildCapabilityQuickViewFacts(selectedRow.artifact),
      )
    : [];

  return (
    <QuickViewPanel data-testid={dataTestId}>
      <QuickViewBody>
        <QuickViewPreviewPane>
          {selectedRow ? (
            <>
              <QuickViewPreviewHeader>
                <QuickViewPreviewLead>
                  <QuickViewPreviewTitle>
                    Preview: {selectedRow.label ?? selectedRow.artifact.file.name}
                  </QuickViewPreviewTitle>
                  {previewFacts.length ? (
                    <QuickViewPreviewSummary>
                      {previewFacts.map((fact) => fact.value).join(" · ")}
                    </QuickViewPreviewSummary>
                  ) : null}
                </QuickViewPreviewLead>
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

        {artifactRows.length ? (
          <QuickViewTreePane>
            {groups.map((group) => (
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
            ))}
          </QuickViewTreePane>
        ) : null}
      </QuickViewBody>
    </QuickViewPanel>
  );
}

function compareArtifacts(
  left: ShellWorkspaceArtifact,
  right: ShellWorkspaceArtifact,
): number {
  return (
    left.bucket.localeCompare(right.bucket) ||
    left.producerLabel.localeCompare(right.producerLabel) ||
    right.createdAt.localeCompare(left.createdAt) ||
    left.file.name.localeCompare(right.file.name)
  );
}

function bucketLabel(bucket: string): string {
  switch (bucket) {
    case "uploaded":
      return "Uploads";
    case "data":
      return "Data";
    case "chart":
      return "Charts";
    case "pdf":
      return "PDF";
    default:
      return bucket;
  }
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

const QuickViewPanel = styled.section`
  display: grid;
  gap: 0.6rem;
  min-height: 0;
`;

const QuickViewBody = styled.div`
  display: grid;
  gap: 0.6rem;
  min-height: 0;
`;

const QuickViewTreePane = styled.section`
  min-height: 150px;
  max-height: 220px;
  overflow: auto;
  border: 1px solid rgba(31, 41, 55, 0.18);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.78);
  padding: 0.6rem;
`;

const QuickViewGroup = styled.div`
  display: grid;
  gap: 0.18rem;

  & + & {
    margin-top: 0.72rem;
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
  font-size: 0.74rem;
  font-weight: 700;
  line-height: 1.2;
  padding: 0.12rem 0;
`;

const QuickViewArtifactRow = styled.div<{ $selected: boolean }>`
  border-radius: 12px;
  background: ${({ $selected }) =>
    $selected ? "rgba(201, 111, 59, 0.1)" : "transparent"};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "rgba(151, 72, 31, 0.34)" : "transparent"};
  transition: border-color 160ms ease, background-color 160ms ease,
    transform 160ms ease;
`;

const QuickViewArtifactButton = styled.button`
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 0.42rem 0.44rem;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: transform 160ms ease;

  &:hover {
    transform: translateX(1px);
  }
`;

const QuickViewArtifactLead = styled.div`
  display: grid;
  gap: 0.08rem;
  min-width: 0;
`;

const QuickViewArtifactName = styled.div`
  min-width: 0;
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const QuickViewArtifactMeta = styled(MetaText)`
  font-size: 0.7rem;
`;

const QuickViewPreviewPane = styled.section`
  min-height: 280px;
  border: 1px solid rgba(31, 41, 55, 0.18);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.82);
  padding: 0.78rem;
  display: grid;
  align-content: start;
  gap: 0.62rem;
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.05);
  transition: border-color 180ms ease, box-shadow 180ms ease,
    transform 180ms ease;
`;

const QuickViewPreviewHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
`;

const QuickViewPreviewLead = styled.div`
  display: grid;
  gap: 0.18rem;
  min-width: 0;
  flex: 1 1 260px;
`;

const QuickViewPreviewTitle = styled.h4`
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.2;
`;

const QuickViewPreviewSummary = styled(MetaText)`
  font-size: 0.74rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
`;

const QuickViewPreviewActions = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  flex: 0 0 auto;
`;

const QuickPreviewActionButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--ink);
  padding: 0.36rem 0.68rem;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease,
    transform 160ms ease;

  &:hover {
    background: rgba(250, 246, 239, 0.96);
    border-color: rgba(31, 41, 55, 0.26);
    transform: translateY(-1px);
  }
`;

const QuickViewEmptyState = styled(MetaText)`
  padding: 0.2rem 0;
`;

const QuickPreviewSection = styled.div`
  display: grid;
  gap: 0.48rem;
`;

const QuickPreviewSectionHeader = styled.div`
  display: grid;
  gap: 0.15rem;
`;

const QuickPreviewImage = styled.img`
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(250, 247, 242, 0.88);
`;

const QuickPreviewTableScroller = styled.div`
  overflow: auto;
  max-height: 260px;
  border: 1px solid rgba(31, 41, 55, 0.16);
  border-radius: var(--radius-md);
`;

const QuickPreviewTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.74rem;
`;

const QuickPreviewTh = styled.th`
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0.42rem 0.55rem;
  background: rgba(252, 248, 242, 0.98);
  color: var(--ink);
  text-align: left;
  border-bottom: 1px solid rgba(31, 41, 55, 0.14);
`;

const QuickPreviewTd = styled.td`
  padding: 0.38rem 0.55rem;
  border-bottom: 1px solid rgba(31, 41, 55, 0.08);
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
  border: 1px solid rgba(31, 41, 55, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  color: var(--ink);
  padding: 0.32rem 0.64rem;
  font: inherit;
  font-size: 0.73rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease;

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
  border: 1px solid rgba(31, 41, 55, 0.16);
  background: rgba(20, 24, 31, 0.94);
  color: #eff8ff;
  padding: 0.72rem 0.82rem;
  font-size: 0.72rem;
  line-height: 1.45;
`;

const QuickPreviewInlineMeta = styled.span`
  white-space: nowrap;
`;

const QuickPreviewText = styled.pre`
  margin: 0;
  max-height: 260px;
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.16);
  background: rgba(255, 255, 255, 0.78);
  color: var(--ink);
  padding: 0.72rem 0.82rem;
  font-size: 0.74rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const QuickPreviewIframe = styled.iframe`
  width: 100%;
  min-height: 360px;
  border: 1px solid rgba(31, 41, 55, 0.16);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.92);
`;
