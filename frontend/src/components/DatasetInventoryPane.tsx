import { useMemo, useState } from "react";
import styled from "styled-components";

import type { LocalDataset } from "../types/report";
import { MetaText, panelSurfaceCss, primaryButtonCss } from "../ui/primitives";

const Panel = styled.section`
  ${panelSurfaceCss};
  padding: 1.2rem;
  display: grid;
  gap: 1rem;
`;

const Header = styled.div`
  display: grid;
  gap: 0.35rem;
`;

const Toolbar = styled.div`
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
`;

const UploadInput = styled.input`
  max-width: 100%;
`;

const SecondaryButton = styled.button`
  ${primaryButtonCss};
  background: rgba(31, 41, 55, 0.12);
  color: var(--ink);
`;

const DatasetList = styled.div`
  display: grid;
  gap: 0.8rem;
`;

const DatasetCard = styled.article`
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.72);
  overflow: hidden;
`;

const DatasetButton = styled.button`
  width: 100%;
  border: 0;
  background: transparent;
  padding: 1rem;
  text-align: left;
  display: grid;
  gap: 0.35rem;
  cursor: pointer;
`;

const DatasetMetaRow = styled.div`
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
`;

const Expanded = styled.div`
  border-top: 1px solid rgba(31, 41, 55, 0.08);
  padding: 1rem;
  display: grid;
  gap: 0.8rem;
`;

const TableScroller = styled.div`
  overflow-x: auto;
`;

const Table = styled.table`
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
`;

const Th = styled.th`
  text-align: left;
  padding: 0.7rem 0.75rem;
  border-bottom: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(31, 41, 55, 0.04);
  font-size: 0.9rem;
  max-width: 400px;
`;

const Td = styled.td`
  padding: 0.7rem 0.75rem;
  border-bottom: 1px solid rgba(31, 41, 55, 0.08);
  vertical-align: top;
  max-width: 400px;
`;

const Cell = styled.div`
  max-width: 400px;
  overflow-wrap: anywhere;
  white-space: normal;
`;

const Pager = styled.div`
  display: flex;
  gap: 0.6rem;
  align-items: center;
  flex-wrap: wrap;
`;

const PageButton = styled.button`
  ${primaryButtonCss};
  background: rgba(31, 41, 55, 0.12);
  color: var(--ink);
  padding: 0.7rem 1rem;
`;

const PAGE_SIZE = 10;

export function DatasetInventoryPane({
  datasets,
  onSelectFiles,
  onClearDatasets,
}: {
  datasets: LocalDataset[];
  onSelectFiles: (files: FileList | null) => Promise<void>;
  onClearDatasets: () => void;
}) {
  const [expandedDatasetId, setExpandedDatasetId] = useState<string | null>(null);
  const [pageByDatasetId, setPageByDatasetId] = useState<Record<string, number>>({});

  const expandedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === expandedDatasetId) ?? null,
    [datasets, expandedDatasetId],
  );

  function toggleDataset(datasetId: string) {
    setExpandedDatasetId((current) => (current === datasetId ? null : datasetId));
    setPageByDatasetId((current) => ({ ...current, [datasetId]: 0 }));
  }

  function setDatasetPage(datasetId: string, nextPage: number) {
    setPageByDatasetId((current) => ({ ...current, [datasetId]: nextPage }));
  }

  const currentPage = expandedDataset ? pageByDatasetId[expandedDataset.id] ?? 0 : 0;
  const pagedRows = expandedDataset
    ? expandedDataset.preview_rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
    : [];
  const pageCount = expandedDataset ? Math.max(1, Math.ceil(expandedDataset.preview_rows.length / PAGE_SIZE)) : 1;

  return (
    <Panel>
      <Header>
        <h2>Dataset inventory</h2>
        <MetaText>Select one or more CSV files. Click a file to inspect columns and preview rows 10 at a time.</MetaText>
      </Header>
      <Toolbar>
        <UploadInput type="file" accept=".csv" multiple onChange={(event) => void onSelectFiles(event.target.files)} />
        <SecondaryButton disabled={!datasets.length} onClick={onClearDatasets} type="button">
          Clear files
        </SecondaryButton>
      </Toolbar>
      {datasets.length ? (
        <DatasetList>
          {datasets.map((dataset) => {
            const isExpanded = expandedDatasetId === dataset.id;
            return (
              <DatasetCard key={dataset.id}>
                <DatasetButton onClick={() => toggleDataset(dataset.id)} type="button">
                  <strong>{dataset.name}</strong>
                  <DatasetMetaRow>
                    <MetaText as="span">{dataset.row_count} rows</MetaText>
                    <MetaText as="span">{dataset.columns.length} columns</MetaText>
                    <MetaText as="span">
                      Numeric: {dataset.numeric_columns.length ? dataset.numeric_columns.join(", ") : "none inferred"}
                    </MetaText>
                  </DatasetMetaRow>
                </DatasetButton>
                {isExpanded ? (
                  <Expanded>
                    <MetaText>Columns: {dataset.columns.join(", ")}</MetaText>
                    <TableScroller>
                      <Table>
                        <thead>
                          <tr>
                            {dataset.columns.map((column) => (
                              <Th key={column}>{column}</Th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pagedRows.map((row, rowIndex) => (
                            <tr key={`${dataset.id}-${currentPage}-${rowIndex}`}>
                              {dataset.columns.map((column) => (
                                <Td key={`${dataset.id}-${rowIndex}-${column}`}>
                                  <Cell>{row[column] ?? ""}</Cell>
                                </Td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </TableScroller>
                    <Pager>
                      <PageButton
                        disabled={currentPage === 0}
                        onClick={() => setDatasetPage(dataset.id, Math.max(0, currentPage - 1))}
                        type="button"
                      >
                        Previous
                      </PageButton>
                      <MetaText>
                        Page {currentPage + 1} of {pageCount}
                      </MetaText>
                      <PageButton
                        disabled={currentPage >= pageCount - 1}
                        onClick={() => setDatasetPage(dataset.id, Math.min(pageCount - 1, currentPage + 1))}
                        type="button"
                      >
                        Next
                      </PageButton>
                    </Pager>
                  </Expanded>
                ) : null}
              </DatasetCard>
            );
          })}
        </DatasetList>
      ) : (
        <MetaText>No files selected yet.</MetaText>
      )}
    </Panel>
  );
}
