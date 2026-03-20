import type {
  PdfSmartSplitBundleView,
  ShellWorkspaceArtifact,
} from "../tools/types";

export type SmartSplitArtifactRow = {
  key: string;
  bundleId: string;
  kind: "entry" | "index" | "archive";
  label: string;
  meta: string;
  artifact: ShellWorkspaceArtifact;
};

export type SmartSplitBundleGroup = {
  bundle: PdfSmartSplitBundleView;
  rows: SmartSplitArtifactRow[];
};

function pluralizePages(pageCount: number): string {
  return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

export function buildSmartSplitGroups(
  bundles: PdfSmartSplitBundleView[],
  artifacts: ShellWorkspaceArtifact[],
): SmartSplitBundleGroup[] {
  const artifactsByFileId = new Map(
    artifacts.map((artifact) => [artifact.file.id, artifact] as const),
  );

  return bundles
    .map((bundle) => {
      const rows: SmartSplitArtifactRow[] = [];

      for (const entry of bundle.entries) {
        const artifact = artifactsByFileId.get(entry.fileId);
        if (!artifact) {
          continue;
        }
        rows.push({
          key: `${bundle.id}:entry:${entry.fileId}`,
          bundleId: bundle.id,
          kind: "entry",
          label: entry.title,
          meta: `${entry.name} · ${entry.startPage}-${entry.endPage} · ${pluralizePages(entry.pageCount)}`,
          artifact,
        });
      }

      if (bundle.indexFileId) {
        const artifact = artifactsByFileId.get(bundle.indexFileId);
        if (artifact) {
          rows.push({
            key: `${bundle.id}:index:${bundle.indexFileId}`,
            bundleId: bundle.id,
            kind: "index",
            label: "Index",
            meta: bundle.indexFileName ?? artifact.file.name,
            artifact,
          });
        }
      }

      if (bundle.archiveFileId) {
        const artifact = artifactsByFileId.get(bundle.archiveFileId);
        if (artifact) {
          rows.push({
            key: `${bundle.id}:archive:${bundle.archiveFileId}`,
            bundleId: bundle.id,
            kind: "archive",
            label: "Archive",
            meta: bundle.archiveFileName ?? artifact.file.name,
            artifact,
          });
        }
      }

      return {
        bundle,
        rows,
      };
    })
    .filter((group) => group.rows.length > 0);
}
