import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import type {
  PdfSmartSplitBundleView,
  ShellWorkspaceArtifact,
} from "../tools/types";
import {
  buildCapabilityQuickViewFacts,
  renderDefaultCapabilityQuickViewPreview,
  type CapabilityQuickViewArtifactRow,
} from "./CapabilityQuickView";
import {
  downloadWorkspaceFile,
  openWorkspaceFileInNewTab,
} from "../lib/workspace-artifacts";
import type { ActiveToolInvocation } from "./ChatKitPane";

function formatToolLabel(tool: string): string {
  return tool
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compareArtifacts(
  left: ShellWorkspaceArtifact,
  right: ShellWorkspaceArtifact,
): number {
  return (
    right.createdAt.localeCompare(left.createdAt) ||
    left.file.name.localeCompare(right.file.name)
  );
}

function resolvePendingSourceFileId(
  activity: ActiveToolInvocation | null,
): string | null {
  if (!activity) {
    return null;
  }
  const fileId = activity.params.file_id;
  if (typeof fileId === "string" && fileId.trim()) {
    return fileId.trim();
  }
  const queryPlan = activity.params.query_plan;
  if (
    queryPlan &&
    typeof queryPlan === "object" &&
    "dataset_id" in queryPlan &&
    typeof queryPlan.dataset_id === "string" &&
    queryPlan.dataset_id.trim()
  ) {
    return queryPlan.dataset_id.trim();
  }
  return null;
}

function buildSmartSplitLabels(
  bundles: PdfSmartSplitBundleView[],
): Map<string, string> {
  const labels = new Map<string, string>();

  for (const bundle of bundles) {
    for (const entry of bundle.entries) {
      labels.set(entry.fileId, entry.title);
    }
    if (bundle.indexFileId) {
      labels.set(bundle.indexFileId, "Split index");
    }
    if (bundle.archiveFileId) {
      labels.set(bundle.archiveFileId, "Split archive");
    }
  }

  return labels;
}

export function LatestArtifactPreviewPane({
  artifacts,
  smartSplitBundles = [],
  pendingToolActivity = null,
  pendingAnchorArtifactId = null,
  emptyMessage,
  dataTestId,
}: {
  artifacts: ShellWorkspaceArtifact[];
  smartSplitBundles?: PdfSmartSplitBundleView[];
  pendingToolActivity?: ActiveToolInvocation | null;
  pendingAnchorArtifactId?: string | null;
  emptyMessage: string;
  dataTestId?: string;
}) {
  const previewableArtifacts = useMemo(
    () => [...artifacts].sort(compareArtifacts),
    [artifacts],
  );
  const artifactRows = useMemo<CapabilityQuickViewArtifactRow[]>(
    () =>
      previewableArtifacts.map((artifact) => ({
        kind: "artifact",
        key: artifact.entryId,
        artifact,
      })),
    [previewableArtifacts],
  );
  const smartSplitLabels = useMemo(
    () => buildSmartSplitLabels(smartSplitBundles),
    [smartSplitBundles],
  );
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    previewableArtifacts[0]?.entryId ?? null,
  );
  const [historyIds, setHistoryIds] = useState<string[]>([]);
  const [pageByArtifactId, setPageByArtifactId] = useState<Record<string, number>>(
    {},
  );
  const latestArtifactIdRef = useRef<string | null>(previewableArtifacts[0]?.entryId ?? null);

  useEffect(() => {
    const validIds = new Set(previewableArtifacts.map((artifact) => artifact.entryId));
    const latestArtifactId = previewableArtifacts[0]?.entryId ?? null;

    setHistoryIds((current) => {
      const filtered = current.filter((artifactId) => validIds.has(artifactId));
      if (!latestArtifactId) {
        return filtered;
      }
      if (filtered[0] === latestArtifactId) {
        return filtered;
      }
      return [latestArtifactId, ...filtered.filter((artifactId) => artifactId !== latestArtifactId)].slice(0, 18);
    });

    setSelectedArtifactId((current) => {
      if (!latestArtifactId) {
        return null;
      }
      if (latestArtifactId !== latestArtifactIdRef.current) {
        return latestArtifactId;
      }
      if (current && validIds.has(current)) {
        return current;
      }
      return latestArtifactId;
    });

    latestArtifactIdRef.current = latestArtifactId;
  }, [previewableArtifacts]);

  const selectedArtifact = useMemo(
    () =>
      previewableArtifacts.find((artifact) => artifact.entryId === selectedArtifactId) ??
      null,
    [previewableArtifacts, selectedArtifactId],
  );
  const latestArtifactId = previewableArtifacts[0]?.entryId ?? null;
  const pendingSourceArtifact = useMemo(() => {
    const pendingSourceFileId = resolvePendingSourceFileId(pendingToolActivity);
    if (!pendingSourceFileId || latestArtifactId !== pendingAnchorArtifactId) {
      return null;
    }
    return (
      previewableArtifacts.find((artifact) => artifact.file.id === pendingSourceFileId) ??
      null
    );
  }, [latestArtifactId, pendingAnchorArtifactId, pendingToolActivity, previewableArtifacts]);
  const displayArtifact = pendingSourceArtifact ?? selectedArtifact;
  const displayRow = useMemo<CapabilityQuickViewArtifactRow | null>(() => {
    if (!displayArtifact) {
      return null;
    }
    return (
      artifactRows.find((row) => row.artifact.entryId === displayArtifact.entryId) ?? {
        kind: "artifact",
        key: displayArtifact.entryId,
        artifact: displayArtifact,
      }
    );
  }, [artifactRows, displayArtifact]);
  const historyIndex = selectedArtifactId ? historyIds.indexOf(selectedArtifactId) : -1;
  const canMoveBackward = historyIndex >= 0 && historyIndex < historyIds.length - 1;
  const canMoveForward = historyIndex > 0;
  const previewFacts = displayArtifact
    ? buildCapabilityQuickViewFacts(displayArtifact).map((fact) => fact.value)
    : [];
  const previewLabel = displayArtifact
    ? smartSplitLabels.get(displayArtifact.file.id) ?? displayArtifact.file.name
    : null;
  const preview = displayArtifact && displayRow
    ? renderDefaultCapabilityQuickViewPreview({
        selectedArtifact: displayArtifact,
        selectedRow: displayRow,
        artifactRows,
        currentPage: pageByArtifactId[displayArtifact.entryId] ?? 0,
        setPage: (nextPage) =>
          setPageByArtifactId((current) => ({
            ...current,
            [displayArtifact.entryId]: nextPage,
          })),
        selectArtifact: setSelectedArtifactId,
      })
    : null;

  return (
    <PreviewPanel data-testid={dataTestId}>
      {displayArtifact && previewLabel ? (
        <PreviewGrid>
          <PreviewMetaColumn>
            <PreviewEyebrow>Latest file</PreviewEyebrow>
            <PreviewTitle>Preview: {previewLabel}</PreviewTitle>
            {previewFacts.length ? (
              <PreviewSummary>{previewFacts.join(" · ")}</PreviewSummary>
            ) : null}
            {pendingToolActivity && pendingSourceArtifact ? (
              <PreviewPending>
                {formatToolLabel(pendingToolActivity.name)} in progress.
              </PreviewPending>
            ) : null}
            <PreviewActions>
              <PreviewActionGroup>
                <PreviewArrowButton
                  aria-label="Show older preview"
                  disabled={!canMoveBackward}
                  onClick={() => {
                    if (historyIndex < 0 || historyIndex >= historyIds.length - 1) {
                      return;
                    }
                    setSelectedArtifactId(historyIds[historyIndex + 1] ?? null);
                  }}
                  type="button"
                >
                  ←
                </PreviewArrowButton>
                <PreviewArrowButton
                  aria-label="Show newer preview"
                  disabled={!canMoveForward}
                  onClick={() => {
                    if (historyIndex <= 0) {
                      return;
                    }
                    setSelectedArtifactId(historyIds[historyIndex - 1] ?? null);
                  }}
                  type="button"
                >
                  →
                </PreviewArrowButton>
              </PreviewActionGroup>
              <PreviewActionButton
                onClick={() => openWorkspaceFileInNewTab(displayArtifact.file)}
                type="button"
              >
                Open
              </PreviewActionButton>
              <PreviewActionButton
                onClick={() => downloadWorkspaceFile(displayArtifact.file)}
                type="button"
              >
                Download
              </PreviewActionButton>
            </PreviewActions>
          </PreviewMetaColumn>
          <PreviewBodyColumn>{preview}</PreviewBodyColumn>
        </PreviewGrid>
      ) : (
        <PreviewEmptyState>{emptyMessage}</PreviewEmptyState>
      )}
    </PreviewPanel>
  );
}

const PreviewPanel = styled.section`
  display: grid;
  min-height: 0;
  border: 1px solid rgba(31, 41, 55, 0.16);
  border-radius: var(--radius-xl);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(249, 244, 238, 0.9)),
    var(--panel);
  overflow: hidden;
`;

const PreviewGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(230px, 280px) minmax(0, 1fr);
  min-height: 0;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

const PreviewMetaColumn = styled.div`
  display: grid;
  align-content: start;
  gap: 0.45rem;
  padding: 0.9rem;
  border-right: 1px solid rgba(31, 41, 55, 0.12);

  @media (max-width: 1080px) {
    border-right: 0;
    border-bottom: 1px solid rgba(31, 41, 55, 0.12);
  }
`;

const PreviewEyebrow = styled.div`
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const PreviewTitle = styled.h3`
  margin: 0;
  font-size: 1rem;
  line-height: 1.15;
`;

const PreviewSummary = styled(MetaText)`
  font-size: 0.8rem;
  line-height: 1.45;
`;

const PreviewPending = styled.div`
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--accent-deep);
`;

const PreviewActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.42rem;
`;

const PreviewActionGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  margin-right: 0.22rem;
`;

const PreviewActionButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.75);
  color: var(--ink);
  border-radius: 999px;
  padding: 0.44rem 0.78rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;

  &:hover {
    transform: translateY(-1px);
    border-color: rgba(31, 41, 55, 0.24);
  }
`;

const PreviewArrowButton = styled(PreviewActionButton)`
  padding-inline: 0.62rem;

  &:disabled {
    opacity: 0.4;
    cursor: default;
    transform: none;
  }
`;

const PreviewBodyColumn = styled.div`
  min-width: 0;
  min-height: 0;
  padding: 0.9rem;
  overflow: auto;
`;

const PreviewEmptyState = styled(MetaText)`
  padding: 1rem;
`;
