import { useMemo, useState } from "react";

import {
  DatasetInventoryButton,
  DatasetInventoryCard,
  DatasetInventoryCell,
  DatasetInventoryExpanded,
  DatasetInventoryHeader,
  DatasetInventoryList,
  DatasetInventoryMetaRow,
  DatasetInventoryPageButton,
  DatasetInventoryPager,
  DatasetInventoryPanel,
  DatasetInventoryScroller,
  DatasetInventoryTable,
  DatasetInventoryTd,
  DatasetInventoryTh,
  DatasetInventoryToggle,
  DatasetInventoryToolbar,
  DatasetInventoryUploadInput,
} from "./styles";
import type { LocalDataset } from "../types/report";
import { MetaText } from "../app/styles";

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
    <DatasetInventoryPanel>
      <DatasetInventoryHeader>
        <h2>Dataset inventory</h2>
        <MetaText>Select one or more CSV or tabular JSON files. Click a dataset to inspect columns and preview rows 10 at a time.</MetaText>
      </DatasetInventoryHeader>
      <DatasetInventoryToolbar>
        <DatasetInventoryUploadInput type="file" accept=".csv,.json,application/json,text/csv" multiple onChange={(event) => void onSelectFiles(event.target.files)} />
        <DatasetInventoryButton disabled={!datasets.length} onClick={onClearDatasets} type="button">
          Clear datasets
        </DatasetInventoryButton>
      </DatasetInventoryToolbar>
      {datasets.length ? (
        <DatasetInventoryList>
          {datasets.map((dataset) => {
            const isExpanded = expandedDatasetId === dataset.id;
            return (
              <DatasetInventoryCard key={dataset.id}>
                <DatasetInventoryToggle onClick={() => toggleDataset(dataset.id)} type="button">
                  <strong>{dataset.name}</strong>
                  <DatasetInventoryMetaRow>
                    <MetaText as="span">{dataset.row_count} rows</MetaText>
                    <MetaText as="span">{dataset.columns.length} columns</MetaText>
                    <MetaText as="span">
                      Numeric: {dataset.numeric_columns.length ? dataset.numeric_columns.join(", ") : "none inferred"}
                    </MetaText>
                  </DatasetInventoryMetaRow>
                </DatasetInventoryToggle>
                {isExpanded ? (
                  <DatasetInventoryExpanded>
                    <MetaText>Columns: {dataset.columns.join(", ")}</MetaText>
                    <DatasetInventoryScroller>
                      <DatasetInventoryTable>
                        <thead>
                          <tr>
                            {dataset.columns.map((column) => (
                              <DatasetInventoryTh key={column}>{column}</DatasetInventoryTh>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pagedRows.map((row, rowIndex) => (
                            <tr key={`${dataset.id}-${currentPage}-${rowIndex}`}>
                              {dataset.columns.map((column) => (
                                <DatasetInventoryTd key={`${dataset.id}-${rowIndex}-${column}`}>
                                  <DatasetInventoryCell>{row[column] ?? ""}</DatasetInventoryCell>
                                </DatasetInventoryTd>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </DatasetInventoryTable>
                    </DatasetInventoryScroller>
                    <DatasetInventoryPager>
                      <DatasetInventoryPageButton
                        disabled={currentPage === 0}
                        onClick={() => setDatasetPage(dataset.id, Math.max(0, currentPage - 1))}
                        type="button"
                      >
                        Previous
                      </DatasetInventoryPageButton>
                      <MetaText>
                        Page {currentPage + 1} of {pageCount}
                      </MetaText>
                      <DatasetInventoryPageButton
                        disabled={currentPage >= pageCount - 1}
                        onClick={() => setDatasetPage(dataset.id, Math.min(pageCount - 1, currentPage + 1))}
                        type="button"
                      >
                        Next
                      </DatasetInventoryPageButton>
                    </DatasetInventoryPager>
                  </DatasetInventoryExpanded>
                ) : null}
              </DatasetInventoryCard>
            );
          })}
        </DatasetInventoryList>
      ) : (
        <MetaText>No datasets selected yet.</MetaText>
      )}
    </DatasetInventoryPanel>
  );
}
