import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import type { Entity } from "@openai/chatkit";

import { MetaText, sectionPanelCss, secondaryButtonCss, strongSurfaceCss } from "../app/styles";
import { publishToast } from "../app/toasts";
import { ChatKitPane } from "./ChatKitPane";
import { FarmRecordPanel } from "./FarmRecordPanel";
import {
  createFarm,
  getFarm,
  getFarmRecord,
  listFarms,
  saveFarmRecord,
  searchPlodaiEntities,
  updateFarm,
} from "../lib/api";
import { buildFarmOrderPath } from "../lib/router";
import { normalizeFarmPayload } from "../lib/farm";
import { buildPlodaiEntityPreview } from "../lib/plodai-entities";
import type { FarmDetail, FarmRecordPayload, FarmSummary } from "../types/farm";

type LoadState = {
  farms: FarmSummary[];
  farm: FarmDetail | null;
  record: FarmRecordPayload | null;
};

type FarmViewTab = "overview" | "inventory_orders";

const EMPTY_RECORD: FarmRecordPayload = {
  version: "v1",
  farm_name: "Untitled farm",
  description: null,
  location: null,
  crops: [],
  orders: [],
};

export function PlodaiFarmPane() {
  const [state, setState] = useState<LoadState>({
    farms: [],
    farm: null,
    record: null,
  });
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [farmSearch, setFarmSearch] = useState("");
  const [farmNameDraft, setFarmNameDraft] = useState("");
  const [recordEditorValue, setRecordEditorValue] = useState("");
  const [recordEditorOpen, setRecordEditorOpen] = useState(false);
  const [activeViewTab, setActiveViewTab] = useState<FarmViewTab>("overview");

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      setLoading(true);
      try {
        const farms = await listFarms();
        if (cancelled) {
          return;
        }
        const nextSelectedFarmId = selectedFarmId ?? farms[0]?.id ?? null;
        setState((current) => ({
          ...current,
          farms,
        }));
        setSelectedFarmId(nextSelectedFarmId);
      } catch (error) {
        if (!cancelled) {
          publishToast({
            title: "Unable to load farms",
            message:
              error instanceof Error ? error.message : "The farm list could not be loaded.",
            tone: "error",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [selectedFarmId]);

  useEffect(() => {
    const nextFarmName = state.farm?.name ?? state.record?.farm_name ?? "";
    setFarmNameDraft(nextFarmName);
  }, [state.farm?.id, state.farm?.name, state.record?.farm_name]);

  useEffect(() => {
    let cancelled = false;

    async function loadFarm(farmId: string) {
      setLoading(true);
      try {
        const [farm, recordResponse] = await Promise.all([
          getFarm(farmId),
          getFarmRecord(farmId),
        ]);
        if (cancelled) {
          return;
        }
        setState((current) => ({
          ...current,
          farm,
          record: normalizeFarmPayload(recordResponse.record),
        }));
      } catch (error) {
        if (!cancelled) {
          publishToast({
            title: "Unable to load farm",
            message:
              error instanceof Error ? error.message : "The farm details could not be loaded.",
            tone: "error",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (!selectedFarmId) {
      setState((current) => ({
        ...current,
        farm: null,
        record: null,
      }));
      return;
    }

    void loadFarm(selectedFarmId);
    return () => {
      cancelled = true;
    };
  }, [selectedFarmId]);

  const orderShareUrls = useMemo(() => {
    if (!state.farm || !state.record || typeof window === "undefined") {
      return {};
    }
    const farmId = state.farm.id;
    return Object.fromEntries(
      (state.record.orders ?? []).map((order) => [
        order.id,
        `${window.location.origin}${buildFarmOrderPath(farmId, order.id)}`,
      ]),
    );
  }, [state.farm, state.record]);

  const selectableFarms = useMemo(() => {
    const query = farmSearch.trim().toLowerCase();
    const selectedFarm = state.farms.find((farm) => farm.id === selectedFarmId) ?? null;
    const filteredFarms = query
      ? state.farms.filter((farm) => farm.name.toLowerCase().includes(query))
      : state.farms;

    if (selectedFarm && !filteredFarms.some((farm) => farm.id === selectedFarm.id)) {
      return [selectedFarm, ...filteredFarms];
    }

    return filteredFarms;
  }, [farmSearch, selectedFarmId, state.farms]);

  async function refreshSelectedFarm(): Promise<void> {
    if (!selectedFarmId) {
      return;
    }
    const [farms, farm, recordResponse] = await Promise.all([
      listFarms(),
      getFarm(selectedFarmId),
      getFarmRecord(selectedFarmId),
    ]);
    setState({
      farms,
      farm,
      record: normalizeFarmPayload(recordResponse.record),
    });
  }

  async function handleCreateFarm() {
    setMutating(true);
    try {
      const farm = await createFarm(buildUntitledFarmName(state.farms));
      setSelectedFarmId(farm.id);
      const [farms, farmDetail, recordResponse] = await Promise.all([
        listFarms(),
        getFarm(farm.id),
        getFarmRecord(farm.id),
      ]);
      setState({
        farms,
        farm: farmDetail,
        record: normalizeFarmPayload(recordResponse.record),
      });
    } catch (error) {
      publishToast({
        title: "Unable to create farm",
        message: error instanceof Error ? error.message : "The farm could not be created.",
        tone: "error",
      });
    } finally {
      setMutating(false);
    }
  }

  async function handleRenameFarm() {
    if (!state.farm || !state.record) {
      return;
    }

    const name = farmNameDraft.trim();
    if (!name) {
      publishToast({
        title: "Farm name required",
        message: "Enter a farm name before saving it.",
        tone: "warning",
      });
      return;
    }

    setMutating(true);
    try {
      await Promise.all([
        updateFarm(state.farm.id, { name }),
        saveFarmRecord(state.farm.id, {
          ...state.record,
          farm_name: name,
        }),
      ]);
      await refreshSelectedFarm();
      publishToast({
        title: "Farm name updated",
        message: `Renamed the farm to ${name}.`,
      });
    } catch (error) {
      publishToast({
        title: "Unable to update farm name",
        message: error instanceof Error ? error.message : "The farm name could not be updated.",
        tone: "error",
      });
    } finally {
      setMutating(false);
    }
  }

  function openRecordEditor() {
    setRecordEditorValue(JSON.stringify(state.record ?? EMPTY_RECORD, null, 2));
    setRecordEditorOpen(true);
  }

  async function handleSaveRecord() {
    if (!state.farm) {
      return;
    }

    let parsedRecord: unknown;
    try {
      parsedRecord = JSON.parse(recordEditorValue);
    } catch {
      publishToast({
        title: "Invalid JSON",
        message: "Fix the JSON before saving the farm record.",
        tone: "error",
      });
      return;
    }

    const nextRecord = normalizeFarmPayload(parsedRecord as FarmRecordPayload);
    setMutating(true);
    try {
      await saveFarmRecord(state.farm.id, nextRecord);
      setRecordEditorOpen(false);
      await refreshSelectedFarm();
      publishToast({
        title: "Farm record saved",
        message: `Saved ${nextRecord.farm_name}.`,
      });
    } catch (error) {
      publishToast({
        title: "Unable to save record",
        message: error instanceof Error ? error.message : "The farm record could not be saved.",
        tone: "error",
      });
    } finally {
      setMutating(false);
    }
  }

  return (
    <FarmWorkspaceGrid>
      <FarmMain>
        <FarmSectionCard>
          <FarmToolbar>
            <FarmToolbarInputGroup>
              <FarmFieldLabel htmlFor="farm-search">Search</FarmFieldLabel>
              <FarmInput
                id="farm-search"
                onChange={(event) => setFarmSearch(event.target.value)}
                placeholder="Search farms"
                value={farmSearch}
              />
            </FarmToolbarInputGroup>

            <FarmToolbarInputGroup>
              <FarmFieldLabel htmlFor="farm-select">Farm</FarmFieldLabel>
              <FarmSelect
                id="farm-select"
                onChange={(event) => setSelectedFarmId(event.target.value || null)}
                value={selectedFarmId ?? ""}
              >
                {selectableFarms.length ? null : (
                  <option value="" disabled>
                    {state.farms.length ? "No matching farms" : "No farms yet"}
                  </option>
                )}
                {selectableFarms.map((farm) => (
                  <option key={farm.id} value={farm.id}>
                    {farm.name}
                  </option>
                ))}
              </FarmSelect>
            </FarmToolbarInputGroup>

            <FarmToolbarInputGroup>
              <FarmFieldLabel htmlFor="farm-name">Name</FarmFieldLabel>
              <FarmInput
                disabled={!state.farm}
                id="farm-name"
                onChange={(event) => setFarmNameDraft(event.target.value)}
                placeholder="Edit farm name"
                value={farmNameDraft}
              />
            </FarmToolbarInputGroup>

            <FarmToolbarActions>
              <FarmSecondaryButton
                disabled={mutating || !state.farm || !farmNameDraft.trim()}
                onClick={() => void handleRenameFarm()}
                type="button"
              >
                Save name
              </FarmSecondaryButton>
              <FarmPrimaryButton disabled={mutating} onClick={() => void handleCreateFarm()} type="button">
                New farm
              </FarmPrimaryButton>
            </FarmToolbarActions>
          </FarmToolbar>

          {loading ? (
            <FarmEmptyState>
              <strong>Loading farm</strong>
              <MetaText>Pulling the current farm record, field-photo context, and chat state.</MetaText>
            </FarmEmptyState>
          ) : !state.farm || !state.record ? (
            <FarmEmptyState>
              <strong>No farm selected</strong>
              <MetaText>Create a farm or choose one from the header to open PlodAI.</MetaText>
            </FarmEmptyState>
          ) : (
            <>
              <FarmViewTabs aria-label="Farm views" role="tablist">
                <FarmViewTabButton
                  aria-selected={activeViewTab === "overview"}
                  onClick={() => setActiveViewTab("overview")}
                  role="tab"
                  type="button"
                >
                  Overview
                </FarmViewTabButton>
                <FarmViewTabButton
                  aria-selected={activeViewTab === "inventory_orders"}
                  onClick={() => setActiveViewTab("inventory_orders")}
                  role="tab"
                  type="button"
                >
                  Inventory &amp; orders
                </FarmViewTabButton>
              </FarmViewTabs>

              <FarmPaneGrid>
                <FarmSectionCard>
                  {activeViewTab === "overview" ? (
                    <>
                      <SectionHeader>
                        <div>
                          <SectionEyebrow>Farm overview</SectionEyebrow>
                          <SectionTitle>{state.record.farm_name}</SectionTitle>
                          <MetaText>
                            Canonical farm context lives here. Crop inventory and customer orders now sit on
                            their own tab.
                          </MetaText>
                        </div>
                        <FarmSecondaryButton disabled={mutating} onClick={openRecordEditor} type="button">
                          Edit JSON
                        </FarmSecondaryButton>
                      </SectionHeader>

                      <FarmRecordPanel
                        farm={state.record}
                        isMutating={mutating}
                        onEditFarm={openRecordEditor}
                        orderShareUrls={orderShareUrls}
                        showCropsSection={false}
                        showOrdersSection={false}
                      />
                    </>
                  ) : (
                    <>
                      <SectionHeader>
                        <div>
                          <SectionEyebrow>Inventory &amp; orders</SectionEyebrow>
                          <SectionTitle>Saved blocks and customer offers</SectionTitle>
                          <MetaText>
                            This tab holds the operational inventory view plus the public-facing order list.
                          </MetaText>
                        </div>
                        <FarmSecondaryButton disabled={mutating} onClick={openRecordEditor} type="button">
                          Edit JSON
                        </FarmSecondaryButton>
                      </SectionHeader>

                      <FarmRecordPanel
                        farm={state.record}
                        isMutating={mutating}
                        onEditFarm={openRecordEditor}
                        orderShareUrls={orderShareUrls}
                        showDescriptionSection={false}
                      />
                    </>
                  )}
                </FarmSectionCard>

                <ChatKitPane
                  activeChatId={state.farm!.chat_id ?? null}
                  entitiesConfig={{
                    enabled: true,
                    onTagSearch: async (query: string): Promise<Entity[]> => {
                      const response = await searchPlodaiEntities({
                        farmId: state.farm!.id,
                        query,
                      });
                      return response.entities as Entity[];
                    },
                    onRequestPreview: async (entity) => buildPlodaiEntityPreview(entity),
                  }}
                  farmId={state.farm!.id}
                  onActiveChatChange={(chatId) => {
                    setState((current) =>
                      current.farm
                        ? {
                            ...current,
                            farm: {
                              ...current.farm,
                              chat_id: chatId,
                            },
                          }
                        : current,
                    );
                  }}
                  surfaceMinHeight={720}
                />
              </FarmPaneGrid>
            </>
          )}
        </FarmSectionCard>
      </FarmMain>

      {recordEditorOpen ? (
        <EditorBackdrop>
          <EditorCard>
            <SectionHeader>
              <div>
                <SectionEyebrow>Farm record editor</SectionEyebrow>
                <SectionTitle>Edit canonical JSON</SectionTitle>
                <MetaText>
                  This saves the exact farm record the backend agent and public order pages read.
                </MetaText>
              </div>
            </SectionHeader>
            <EditorTextarea
              onChange={(event) => setRecordEditorValue(event.target.value)}
              spellCheck={false}
              value={recordEditorValue}
            />
            <EditorActions>
              <FarmSecondaryButton disabled={mutating} onClick={() => setRecordEditorOpen(false)} type="button">
                Cancel
              </FarmSecondaryButton>
              <FarmPrimaryButton disabled={mutating} onClick={() => void handleSaveRecord()} type="button">
                Save record
              </FarmPrimaryButton>
            </EditorActions>
          </EditorCard>
        </EditorBackdrop>
      ) : null}
    </FarmWorkspaceGrid>
  );
}

function buildUntitledFarmName(farms: FarmSummary[]): string {
  const untitledCount = farms.filter((farm) => farm.name.startsWith("Untitled farm")).length;
  return untitledCount ? `Untitled farm ${untitledCount + 1}` : "Untitled farm";
}

const FarmWorkspaceGrid = styled.div`
  display: block;
  min-height: 0;
`;

const FarmMain = styled.div`
  display: grid;
  gap: 0.9rem;
  min-width: 0;
`;

const FarmSectionCard = styled.section`
  ${sectionPanelCss("1rem", "0.9rem")};
`;

const FarmToolbar = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(180px, 0.9fr) minmax(220px, 1.1fr) auto;
  gap: 0.7rem;
  align-items: end;

  @media (max-width: 1080px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const FarmToolbarInputGroup = styled.div`
  display: grid;
  gap: 0.35rem;
  min-width: 0;
`;

const FarmFieldLabel = styled.label`
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const FarmToolbarActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  justify-content: flex-end;

  @media (max-width: 720px) {
    justify-content: flex-start;
  }
`;

const FarmViewTabs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
`;

const FarmViewTabButton = styled.button`
  ${secondaryButtonCss};
  border-radius: 999px;

  &[aria-selected="true"] {
    border-color: rgba(21, 128, 61, 0.26);
    background: rgba(21, 128, 61, 0.12);
    color: var(--accent-deep);
  }
`;

const FarmPaneGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(360px, 0.98fr);
  gap: 0.9rem;
  min-width: 0;

  @media (max-width: 1180px) {
    grid-template-columns: 1fr;
  }
`;

const SectionHeader = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.8rem;
  align-items: start;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

const SectionEyebrow = styled.div`
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const SectionTitle = styled.h2`
  margin: 0.15rem 0 0.35rem;
  font-family: var(--font-display);
  font-size: clamp(1.25rem, 2vw, 1.8rem);
`;

const FarmInput = styled.input`
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.75rem 0.9rem;
  background: rgba(255, 255, 255, 0.8);
  min-width: 0;
`;

const FarmSelect = styled.select`
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.75rem 0.9rem;
  background: rgba(255, 255, 255, 0.8);
  min-width: 0;
  font: inherit;
  color: var(--ink);
`;

const FarmPrimaryButton = styled.button`
  ${secondaryButtonCss};
  background: var(--accent);
  color: white;
`;

const FarmSecondaryButton = styled.button`
  ${secondaryButtonCss};
`;

const FarmEmptyState = styled.div`
  ${strongSurfaceCss};
  padding: 1rem;
  display: grid;
  gap: 0.45rem;
`;

const EditorBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(16, 24, 40, 0.46);
  backdrop-filter: blur(10px);
`;

const EditorCard = styled.section`
  ${sectionPanelCss("1rem", "0.8rem")};
  width: min(920px, 100%);
  max-height: calc(100vh - 2rem);
`;

const EditorTextarea = styled.textarea`
  width: 100%;
  min-height: 420px;
  resize: vertical;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.95rem;
  background: rgba(255, 255, 255, 0.82);
  font-family: "SFMono-Regular", "SFMono-Regular", Consolas, monospace;
  line-height: 1.55;
`;

const EditorActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
`;
