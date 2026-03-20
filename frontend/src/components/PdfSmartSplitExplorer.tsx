import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import type {
  PdfSmartSplitBundleView,
  ShellWorkspaceArtifact,
} from "../tools/types";
import {
  buildSmartSplitGroups,
  type SmartSplitArtifactRow,
} from "./pdfSmartSplitGroups";
import {
  downloadWorkspaceFile,
  openWorkspaceFileInNewTab,
} from "../lib/workspace-artifacts";
import {
  buildCapabilityQuickViewFacts,
  PdfInlinePreview,
  renderDefaultCapabilityQuickViewPreview,
  type CapabilityQuickViewArtifactRow,
} from "./CapabilityQuickView";

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function PdfSmartSplitExplorer({
  title,
  description,
  emptyMessage,
  bundles,
  artifacts,
  dataTestId,
}: {
  title: string;
  description: string;
  emptyMessage: string;
  bundles: PdfSmartSplitBundleView[];
  artifacts: ShellWorkspaceArtifact[];
  dataTestId?: string;
}) {
  const groups = useMemo(
    () => buildSmartSplitGroups(bundles, artifacts),
    [artifacts, bundles],
  );
  const artifactRows = useMemo(
    () => groups.flatMap((group) => group.rows),
    [groups],
  );
  const quickViewRows = useMemo<CapabilityQuickViewArtifactRow[]>(
    () =>
      artifactRows.map((row) => ({
        kind: "artifact",
        key: row.key,
        artifact: row.artifact,
        label: row.label,
        meta: row.meta,
      })),
    [artifactRows],
  );
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    artifactRows[0]?.artifact.entryId ?? null,
  );
  const [expandedBundleId, setExpandedBundleId] = useState<string | null>(
    groups[0]?.bundle.id ?? null,
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
      return artifactRows[0]?.artifact.entryId ?? null;
    });
  }, [artifactRows]);

  useEffect(() => {
    if (!groups.length) {
      setExpandedBundleId(null);
      return;
    }
    const selectedGroup = groups.find((group) =>
      group.rows.some((row) => row.artifact.entryId === selectedArtifactId),
    );
    if (selectedGroup) {
      setExpandedBundleId(selectedGroup.bundle.id);
      return;
    }
    setExpandedBundleId((current) =>
      current && groups.some((group) => group.bundle.id === current)
        ? current
        : groups[0]?.bundle.id ?? null,
    );
  }, [groups, selectedArtifactId]);

  const selectedRow = useMemo(
    () =>
      artifactRows.find((row) => row.artifact.entryId === selectedArtifactId) ??
      null,
    [artifactRows, selectedArtifactId],
  );

  const preview = selectedRow
    ? renderSmartSplitPreview({
        row: selectedRow,
        artifactRows,
        quickViewRows,
        currentPage: pageByArtifactId[selectedRow.artifact.entryId] ?? 0,
        setPage: (nextPage) =>
          setPageByArtifactId((current) => ({
            ...current,
            [selectedRow.artifact.entryId]: nextPage,
          })),
        selectArtifact: setSelectedArtifactId,
      })
    : null;
  const previewSummary = selectedRow
    ? buildCapabilityQuickViewFacts(selectedRow.artifact)
        .map((fact) => fact.value)
        .join(" · ")
    : "";

  return (
    <ExplorerPanel data-testid={dataTestId}>
      <ExplorerHeader>
        <div>
          <ExplorerTitle>{title}</ExplorerTitle>
          <MetaText>{description}</MetaText>
        </div>
      </ExplorerHeader>

      <ExplorerBody>
        <ExplorerTreePane>
          {groups.length ? (
            groups.map((group) => {
              const isExpanded = expandedBundleId === group.bundle.id;
              return (
                <BundleSection key={group.bundle.id}>
                  <BundleToggle
                    aria-expanded={isExpanded}
                    onClick={() =>
                      setExpandedBundleId((current) =>
                        current === group.bundle.id ? null : group.bundle.id,
                      )
                    }
                    type="button"
                  >
                    <BundleChevron $expanded={isExpanded}>▾</BundleChevron>
                    <BundleLead>
                      <BundleTitle>{group.bundle.sourceFileName}</BundleTitle>
                      <BundleMeta>
                        {group.rows.filter((row) => row.kind === "entry").length} splits
                      </BundleMeta>
                    </BundleLead>
                  </BundleToggle>
                  {isExpanded ? (
                    <BundleChildren>
                      {group.rows.map((row) => (
                        <BundleNode
                          key={row.key}
                          $selected={row.artifact.entryId === selectedArtifactId}
                        >
                          <BundleNodeButton
                            onClick={() => setSelectedArtifactId(row.artifact.entryId)}
                            type="button"
                          >
                            <BundleNodeKind>{row.kind}</BundleNodeKind>
                            <BundleNodeLead>
                              <BundleNodeLabel>{row.label}</BundleNodeLabel>
                              <BundleNodeMeta>{row.meta}</BundleNodeMeta>
                            </BundleNodeLead>
                          </BundleNodeButton>
                        </BundleNode>
                      ))}
                    </BundleChildren>
                  ) : null}
                </BundleSection>
              );
            })
          ) : (
            <ExplorerEmptyState>{emptyMessage}</ExplorerEmptyState>
          )}
        </ExplorerTreePane>

        <ExplorerPreviewPane>
          {selectedRow ? (
            <>
              <ExplorerPreviewHeader>
                <ExplorerPreviewLead>
                  <ExplorerPreviewTitle>
                    Preview: {selectedRow.label}
                  </ExplorerPreviewTitle>
                  {previewSummary ? (
                    <ExplorerPreviewSummary>{previewSummary}</ExplorerPreviewSummary>
                  ) : null}
                </ExplorerPreviewLead>
                <ExplorerPreviewActions>
                  <ExplorerActionButton
                    onClick={() => openWorkspaceFileInNewTab(selectedRow.artifact.file)}
                    type="button"
                  >
                    Open
                  </ExplorerActionButton>
                  <ExplorerActionButton
                    onClick={() => downloadWorkspaceFile(selectedRow.artifact.file)}
                    type="button"
                  >
                    Download
                  </ExplorerActionButton>
                </ExplorerPreviewActions>
              </ExplorerPreviewHeader>
              {preview}
            </>
          ) : (
            <ExplorerEmptyState>{emptyMessage}</ExplorerEmptyState>
          )}
        </ExplorerPreviewPane>
      </ExplorerBody>
    </ExplorerPanel>
  );
}

function renderSmartSplitPreview({
  row,
  artifactRows,
  quickViewRows,
  currentPage,
  setPage,
  selectArtifact,
}: {
  row: SmartSplitArtifactRow;
  artifactRows: SmartSplitArtifactRow[];
  quickViewRows: CapabilityQuickViewArtifactRow[];
  currentPage: number;
  setPage: (nextPage: number) => void;
  selectArtifact: (entryId: string) => void;
}) {
  const file = row.artifact.file;

  if (
    row.kind === "index" &&
    file.kind === "other" &&
    typeof file.text_content === "string"
  ) {
    return (
      <PreviewSection>
        <PreviewSectionHeader>
          <strong>Smart split index</strong>
          <MetaText>{row.meta}</MetaText>
        </PreviewSectionHeader>
        <PreviewMarkdown>
          <ReactMarkdown
            components={{
              a: ({ href, children }) => {
                const targetFileName = href ? basename(href) : "";
                const target = artifactRows.find(
                  (candidate) =>
                    candidate.bundleId === row.bundleId &&
                    candidate.artifact.file.name === targetFileName,
                );
                if (!target) {
                  return (
                    <a href={href} rel="noreferrer" target="_blank">
                      {children}
                    </a>
                  );
                }
                return (
                  <PreviewLinkButton
                    onClick={() => selectArtifact(target.artifact.entryId)}
                    type="button"
                  >
                    {children}
                  </PreviewLinkButton>
                );
              },
            }}
          >
            {file.text_content}
          </ReactMarkdown>
        </PreviewMarkdown>
      </PreviewSection>
    );
  }

  if (file.kind === "pdf") {
    return <PdfInlinePreview file={file} />;
  }

  return renderDefaultCapabilityQuickViewPreview({
    selectedArtifact: row.artifact,
    selectedRow:
      quickViewRows.find((candidate) => candidate.artifact.entryId === row.artifact.entryId) ??
      quickViewRows[0]!,
    artifactRows: quickViewRows,
    currentPage,
    setPage,
    selectArtifact,
  });
}

const ExplorerPanel = styled.section`
  display: grid;
  gap: 0.62rem;
  min-height: 0;
`;

const ExplorerHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
`;

const ExplorerTitle = styled.h2`
  margin: 0;
  font-size: 1.05rem;
`;

const ExplorerBody = styled.div`
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(320px, 1.1fr);
  gap: 0.65rem;
  min-height: min(64vh, 720px);

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
    min-height: 0;
  }
`;

const ExplorerTreePane = styled.section`
  display: grid;
  align-content: start;
  gap: 0.55rem;
  min-height: 0;
  max-height: min(64vh, 720px);
  overflow: auto;
  padding: 0.25rem 0.1rem 0.25rem 0;
`;

const BundleSection = styled.section`
  display: grid;
  gap: 0.18rem;
`;

const BundleToggle = styled.button`
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  width: 100%;
  text-align: left;
  border: 1px solid rgba(31, 41, 55, 0.16);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.82);
  padding: 0.6rem 0.68rem;
  font: inherit;
  cursor: pointer;
  transition: border-color 160ms ease, background-color 160ms ease,
    transform 160ms ease;

  &:hover {
    border-color: rgba(31, 41, 55, 0.26);
    background: rgba(255, 250, 245, 0.9);
    transform: translateY(-1px);
  }
`;

const BundleChevron = styled.span<{ $expanded: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  color: rgba(31, 41, 55, 0.64);
  transform: rotate(${({ $expanded }) => ($expanded ? "0deg" : "-90deg")});
  transition: transform 140ms ease;
`;

const BundleLead = styled.div`
  display: grid;
  gap: 0.1rem;
  min-width: 0;
`;

const BundleTitle = styled.div`
  min-width: 0;
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const BundleMeta = styled(MetaText)`
  font-size: 0.73rem;
`;

const BundleChildren = styled.div`
  display: grid;
  gap: 0.18rem;
  padding-left: 1.2rem;
`;

const BundleNode = styled.div<{ $selected: boolean }>`
  border-radius: var(--radius-md);
  background: ${({ $selected }) =>
    $selected ? "rgba(202, 106, 46, 0.1)" : "transparent"};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "rgba(143, 73, 35, 0.34)" : "transparent"};
  transition: background-color 160ms ease, border-color 160ms ease;
`;

const BundleNodeButton = styled.button`
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 0.38rem 0.5rem;
  font: inherit;
  cursor: pointer;
  transition: transform 160ms ease;

  &:hover {
    transform: translateX(1px);
  }
`;

const BundleNodeKind = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.6rem;
  padding: 0.16rem 0.4rem;
  border-radius: 999px;
  background: rgba(31, 41, 55, 0.07);
  color: rgba(31, 41, 55, 0.72);
  font-size: 0.63rem;
  font-weight: 700;
  text-transform: uppercase;
`;

const BundleNodeLead = styled.div`
  display: grid;
  gap: 0.05rem;
  min-width: 0;
`;

const BundleNodeLabel = styled.div`
  min-width: 0;
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const BundleNodeMeta = styled(MetaText)`
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ExplorerPreviewPane = styled.section`
  min-height: 280px;
  border: 1px solid rgba(31, 41, 55, 0.18);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.82);
  padding: 0.78rem;
  display: grid;
  align-content: start;
  gap: 0.6rem;
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.05);
`;

const ExplorerPreviewHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
`;

const ExplorerPreviewLead = styled.div`
  display: grid;
  gap: 0.18rem;
  min-width: 0;
  flex: 1 1 240px;
`;

const ExplorerPreviewTitle = styled.h4`
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.2;
`;

const ExplorerPreviewSummary = styled(MetaText)`
  font-size: 0.74rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
`;

const ExplorerPreviewActions = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  flex: 0 0 auto;
`;

const ExplorerActionButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.18);
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
    background: rgba(249, 244, 236, 0.96);
    border-color: rgba(31, 41, 55, 0.3);
    transform: translateY(-1px);
  }
`;

const ExplorerEmptyState = styled(MetaText)`
  padding: 0.2rem 0;
`;

const PreviewSection = styled.div`
  display: grid;
  gap: 0.48rem;
`;

const PreviewSectionHeader = styled.div`
  display: grid;
  gap: 0.15rem;
`;

const PreviewMarkdown = styled.div`
  display: grid;
  gap: 0.48rem;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.16);
  background: rgba(255, 255, 255, 0.84);
  padding: 0.68rem 0.78rem;
  line-height: 1.5;

  & > * {
    min-width: 0;
  }

  p,
  ul,
  ol,
  h1,
  h2,
  h3,
  h4 {
    margin: 0;
  }
`;

const PreviewLinkButton = styled.button`
  border: 0;
  background: none;
  color: var(--accent-deep);
  font: inherit;
  font-weight: 700;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
`;
