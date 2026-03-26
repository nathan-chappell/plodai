import { useEffect, useMemo, useRef, useState } from "react";
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
import { UNNAMED_FARM_LABEL, getFarmDisplayName, normalizeFarmPayload } from "../lib/farm";
import { buildPlodaiEntityPreview } from "../lib/plodai-entities";
import type { FarmDetail, FarmRecordPayload, FarmSummary } from "../types/farm";

type LoadState = {
  farms: FarmSummary[];
  farm: FarmDetail | null;
  record: FarmRecordPayload | null;
};

type FarmViewTab = "overview" | "orders";

const EMPTY_RECORD: FarmRecordPayload = {
  version: "v1",
  farm_name: "",
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
  const selectedFarmIdRef = useRef<string | null>(selectedFarmId);
  const farmLoadRequestIdRef = useRef(0);

  useEffect(() => {
    selectedFarmIdRef.current = selectedFarmId;
  }, [selectedFarmId]);

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

  async function loadFarmState(farmId: string): Promise<LoadState> {
    const [farms, farm, recordResponse] = await Promise.all([
      listFarms(),
      getFarm(farmId),
      getFarmRecord(farmId),
    ]);

    return {
      farms,
      farm,
      record: normalizeFarmPayload(recordResponse.record),
    };
  }

  useEffect(() => {
    let cancelled = false;

    async function loadFarm(farmId: string) {
      const requestId = ++farmLoadRequestIdRef.current;
      setLoading(true);
      try {
        const nextState = await loadFarmState(farmId);
        if (
          cancelled ||
          selectedFarmIdRef.current !== farmId ||
          farmLoadRequestIdRef.current !== requestId
        ) {
          return;
        }
        setState(nextState);
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
        if (
          !cancelled &&
          selectedFarmIdRef.current === farmId &&
          farmLoadRequestIdRef.current === requestId
        ) {
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
      ? state.farms.filter((farm) => getFarmDisplayName(farm.name).toLowerCase().includes(query))
      : state.farms;

    if (selectedFarm && !filteredFarms.some((farm) => farm.id === selectedFarm.id)) {
      return [selectedFarm, ...filteredFarms];
    }

    return filteredFarms;
  }, [farmSearch, selectedFarmId, state.farms]);

  async function refreshSelectedFarm(): Promise<void> {
    const farmId = selectedFarmIdRef.current;
    if (!farmId) {
      return;
    }
    try {
      const requestId = ++farmLoadRequestIdRef.current;
      const nextState = await loadFarmState(farmId);
      if (
        selectedFarmIdRef.current !== farmId ||
        farmLoadRequestIdRef.current !== requestId
      ) {
        return;
      }
      setState(nextState);
    } catch (error) {
      publishToast({
        title: "Unable to refresh farm",
        message:
          error instanceof Error ? error.message : "The latest farm updates could not be loaded.",
        tone: "error",
      });
    }
  }

  async function handleCreateFarm() {
    setMutating(true);
    try {
      const farm = await createFarm(buildUntitledFarmName(state.farms));
      setSelectedFarmId(farm.id);
      selectedFarmIdRef.current = farm.id;
      const nextState = await loadFarmState(farm.id);
      setState(nextState);
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
        message: `Saved ${getFarmDisplayName(nextRecord.farm_name)}.`,
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
                    {getFarmDisplayName(farm.name)}
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
                placeholder={state.farm ? UNNAMED_FARM_LABEL : "Edit farm name"}
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
            <FarmContent>
              <FarmViewBar>
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
                    aria-selected={activeViewTab === "orders"}
                    onClick={() => setActiveViewTab("orders")}
                    role="tab"
                    type="button"
                  >
                    Orders
                  </FarmViewTabButton>
                </FarmViewTabs>

                <FarmUtilityButton disabled={mutating} onClick={openRecordEditor} type="button">
                  Edit JSON
                </FarmUtilityButton>
              </FarmViewBar>

              <FarmPaneGrid>
                <FarmDetailPane>
                  {activeViewTab === "overview" ? (
                    <FarmRecordPanel
                      farm={state.record}
                      isMutating={mutating}
                      onEditFarm={openRecordEditor}
                      orderShareUrls={orderShareUrls}
                      showOrdersSection={false}
                    />
                  ) : (
                    <FarmRecordPanel
                      farm={state.record}
                      isMutating={mutating}
                      onEditFarm={openRecordEditor}
                      orderShareUrls={orderShareUrls}
                      showCropsSection={false}
                      showDescriptionSection={false}
                    />
                  )}
                </FarmDetailPane>

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
                  onClientEffect={(effect) => {
                    if (effect.name !== "farm_record_updated") {
                      return;
                    }
                    void refreshSelectedFarm();
                  }}
                />
              </FarmPaneGrid>
            </FarmContent>
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
  const unnamedCount = farms.filter((farm) => {
    const displayName = getFarmDisplayName(farm.name);
    return (
      displayName === UNNAMED_FARM_LABEL ||
      displayName.startsWith(`${UNNAMED_FARM_LABEL} `)
    );
  }).length;
  return unnamedCount ? `${UNNAMED_FARM_LABEL} ${unnamedCount + 1}` : UNNAMED_FARM_LABEL;
}

const FarmWorkspaceGrid = styled.div`
  display: grid;
  min-height: 0;
  height: 100%;
`;

const FarmMain = styled.div`
  display: grid;
  gap: 0.9rem;
  min-width: 0;
  min-height: 0;
  height: 100%;
`;

const FarmSectionCard = styled.section`
  ${sectionPanelCss("1rem", "0.9rem")};
  min-height: 0;
  height: 100%;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
`;

const FarmToolbar = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(180px, 0.9fr) minmax(220px, 1.1fr) auto;
  gap: 0.5rem 0.65rem;
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
  gap: 0.22rem;
  min-width: 0;
`;

const FarmFieldLabel = styled.label`
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-deep);
  opacity: 0.86;
`;

const FarmToolbarActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.38rem;
  justify-content: flex-end;

  @media (max-width: 720px) {
    justify-content: flex-start;
  }
`;

const FarmContent = styled.div`
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0.6rem;
  overflow: hidden;
`;

const FarmViewBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  min-width: 0;

  @media (max-width: 720px) {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
`;

const FarmViewTabs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.18rem;
  width: fit-content;
  max-width: 100%;
  padding: 0.16rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(249, 246, 241, 0.88);
`;

const FarmViewTabButton = styled.button`
  appearance: none;
  border: 0;
  border-radius: 999px;
  min-height: 1.75rem;
  padding: 0.18rem 0.62rem;
  background: transparent;
  color: color-mix(in srgb, var(--ink) 76%, var(--muted) 24%);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease;

  &[aria-selected="true"] {
    background: rgba(255, 255, 255, 0.96);
    color: var(--accent-deep);
    box-shadow: 0 1px 0 rgba(31, 41, 55, 0.06), 0 0 0 1px rgba(21, 128, 61, 0.16);
  }
`;

const FarmPaneGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(360px, 0.98fr);
  gap: 0.9rem;
  min-width: 0;
  min-height: 0;
  height: 100%;
  align-items: stretch;

  @media (max-width: 1180px) {
    grid-template-columns: 1fr;
    height: auto;
  }
`;

const FarmDetailPane = styled.section`
  ${sectionPanelCss("0.72rem", "0.72rem")};
  min-height: 0;
  height: 100%;
  overflow: hidden;
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
  min-height: 2.2rem;
  padding: 0.46rem 0.7rem;
  background: rgba(255, 255, 255, 0.8);
  min-width: 0;
  font: inherit;
  font-size: 0.92rem;
`;

const FarmSelect = styled.select`
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  min-height: 2.2rem;
  padding: 0.46rem 0.7rem;
  background: rgba(255, 255, 255, 0.8);
  min-width: 0;
  font: inherit;
  font-size: 0.92rem;
  color: var(--ink);
`;

const FarmPrimaryButton = styled.button`
  ${secondaryButtonCss};
  background: var(--accent);
  color: white;
  min-height: 2.2rem;
  padding: 0.42rem 0.78rem;
  font-size: 0.82rem;
`;

const FarmSecondaryButton = styled.button`
  ${secondaryButtonCss};
  min-height: 2.2rem;
  padding: 0.42rem 0.78rem;
  font-size: 0.82rem;
`;

const FarmUtilityButton = styled(FarmSecondaryButton)`
  min-height: 1.75rem;
  padding: 0.18rem 0.62rem;
  font-size: 0.76rem;
`;

const FarmEmptyState = styled.div`
  ${strongSurfaceCss};
  padding: 1rem;
  display: grid;
  gap: 0.45rem;
  min-height: 100%;
  align-content: center;
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
