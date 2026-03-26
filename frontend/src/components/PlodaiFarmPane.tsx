import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import type { Entity } from "@openai/chatkit";

import { MetaText, sectionPanelCss, secondaryButtonCss, strongSurfaceCss } from "../app/styles";
import { publishToast } from "../app/toasts";
import { ChatKitPane } from "./ChatKitPane";
import { FarmRecordPanel } from "./FarmRecordPanel";
import {
  createFarm,
  deleteFarm,
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

export function PlodaiFarmPane() {
  const [state, setState] = useState<LoadState>({
    farms: [],
    farm: null,
    record: null,
  });
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
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
    if (!state.farm || !state.record || typeof window === "undefined") {
      return;
    }

    const currentName = state.record.farm_name.trim() || state.farm.name || "";
    const nextName = window.prompt("Rename farm", currentName);
    if (nextName === null) {
      return;
    }

    const cleanedName = nextName.trim();
    if (!cleanedName) {
      publishToast({
        title: "Farm name required",
        message: "Enter a farm name before saving it.",
        tone: "warning",
      });
      return;
    }
    if (cleanedName === currentName) {
      return;
    }

    setMutating(true);
    try {
      await Promise.all([
        updateFarm(state.farm.id, { name: cleanedName }),
        saveFarmRecord(state.farm.id, {
          ...state.record,
          farm_name: cleanedName,
        }),
      ]);
      await refreshSelectedFarm();
      publishToast({
        title: "Farm name updated",
        message: `Renamed the farm to ${cleanedName}.`,
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

  async function handleEditDescription() {
    if (!state.farm || !state.record || typeof window === "undefined") {
      return;
    }

    const currentDescription = state.record.description ?? "";
    const nextDescription = window.prompt(
      "Update farm description. Leave blank to clear it.",
      currentDescription,
    );
    if (nextDescription === null) {
      return;
    }

    const cleanedDescription = nextDescription.trim() || null;
    const previousDescription = state.record.description?.trim() || null;
    if (cleanedDescription === previousDescription) {
      return;
    }

    setMutating(true);
    try {
      await saveFarmRecord(state.farm.id, {
        ...state.record,
        description: cleanedDescription,
      });
      await refreshSelectedFarm();
      publishToast({
        title: "Farm description updated",
        message: cleanedDescription
          ? `Updated the description for ${getFarmDisplayName(state.record.farm_name)}.`
          : `Cleared the description for ${getFarmDisplayName(state.record.farm_name)}.`,
      });
    } catch (error) {
      publishToast({
        title: "Unable to update farm description",
        message: error instanceof Error ? error.message : "The farm description could not be updated.",
        tone: "error",
      });
    } finally {
      setMutating(false);
    }
  }

  async function handleDeleteCrop(cropId: string) {
    if (!state.farm || !state.record) {
      return;
    }

    const crop = state.record.crops.find((candidate) => candidate.id === cropId);
    if (!crop) {
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Delete crop "${crop.name}"?`);
      if (!confirmed) {
        return;
      }
    }

    setMutating(true);
    try {
      await saveFarmRecord(state.farm.id, {
        ...state.record,
        crops: state.record.crops.filter((candidate) => candidate.id !== cropId),
      });
      await refreshSelectedFarm();
      publishToast({
        title: "Crop deleted",
        message: `Removed ${crop.name} from ${getFarmDisplayName(state.record.farm_name)}.`,
      });
    } catch (error) {
      publishToast({
        title: "Unable to delete crop",
        message: error instanceof Error ? error.message : "The crop could not be removed.",
        tone: "error",
      });
    } finally {
      setMutating(false);
    }
  }

  async function handleDeleteFarm() {
    if (!state.farm || typeof window === "undefined") {
      return;
    }

    const deletedFarmId = state.farm.id;
    const farmName = getFarmDisplayName(state.record?.farm_name ?? state.farm.name);
    const confirmed = window.confirm(
      `Delete ${farmName}? This will remove its saved record, images, and chat history.`,
    );
    if (!confirmed) {
      return;
    }

    setMutating(true);
    try {
      await deleteFarm(deletedFarmId);
      const farms = await listFarms();
      const nextSelectedFarmId =
        farms.find((farm) => farm.id !== deletedFarmId)?.id ?? farms[0]?.id ?? null;
      selectedFarmIdRef.current = nextSelectedFarmId;
      setSelectedFarmId(nextSelectedFarmId);
      setActiveViewTab("overview");
      setState((current) => ({
        ...current,
        farms,
        farm: null,
        record: null,
      }));
      publishToast({
        title: "Farm deleted",
        message: `Deleted ${farmName}.`,
      });
    } catch (error) {
      publishToast({
        title: "Unable to delete farm",
        message: error instanceof Error ? error.message : "The farm could not be deleted.",
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
          <FarmPaneGrid>
            <FarmDetailPane>
              <FarmToolbar>
                <FarmToolbarInputGroup>
                  <FarmFieldLabel htmlFor="farm-select">Farm</FarmFieldLabel>
                  <FarmSelect
                    id="farm-select"
                    onChange={(event) => setSelectedFarmId(event.target.value || null)}
                    value={selectedFarmId ?? ""}
                  >
                    {state.farms.length ? null : (
                      <option value="" disabled>
                        No farms yet
                      </option>
                    )}
                    {state.farms.map((farm) => (
                      <option key={farm.id} value={farm.id}>
                        {getFarmDisplayName(farm.name)}
                      </option>
                    ))}
                  </FarmSelect>
                </FarmToolbarInputGroup>

                <FarmToolbarActions>
                  <FarmSecondaryButton
                    disabled={mutating || !state.record}
                    onClick={() => void handleRenameFarm()}
                    type="button"
                  >
                    Rename
                  </FarmSecondaryButton>
                  <FarmSecondaryButton
                    disabled={mutating || !state.record}
                    onClick={() => void handleEditDescription()}
                    type="button"
                  >
                    Edit description
                  </FarmSecondaryButton>
                  <FarmDangerButton
                    disabled={mutating || !state.farm}
                    onClick={() => void handleDeleteFarm()}
                    type="button"
                  >
                    Delete farm
                  </FarmDangerButton>
                  <FarmPrimaryButton disabled={mutating} onClick={() => void handleCreateFarm()} type="button">
                    New farm
                  </FarmPrimaryButton>
                </FarmToolbarActions>
              </FarmToolbar>

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

              <FarmDetailBody>
                {loading ? (
                  <FarmEmptyState>
                    <strong>Loading farm</strong>
                    <MetaText>Pulling the current farm record, field-photo context, and chat state.</MetaText>
                  </FarmEmptyState>
                ) : !state.farm || !state.record ? (
                  <FarmEmptyState>
                    <strong>No farm selected</strong>
                    <MetaText>Create a farm or choose one from the farm pane to open PlodAI.</MetaText>
                  </FarmEmptyState>
                ) : activeViewTab === "overview" ? (
                  <FarmRecordPanel
                    farm={state.record}
                    isMutating={mutating}
                    onDeleteCrop={(cropId) => void handleDeleteCrop(cropId)}
                    orderShareUrls={orderShareUrls}
                    showDescriptionSection={false}
                    showOrdersSection={false}
                  />
                ) : (
                  <FarmRecordPanel
                    farm={state.record}
                    isMutating={mutating}
                    orderShareUrls={orderShareUrls}
                    showCropsSection={false}
                    showDescriptionSection={false}
                  />
                )}
              </FarmDetailBody>
            </FarmDetailPane>

            <ChatKitPane
              activeChatId={state.farm?.chat_id ?? null}
              entitiesConfig={{
                enabled: true,
                onTagSearch: async (query: string): Promise<Entity[]> => {
                  if (!state.farm?.id) {
                    return [];
                  }
                  const response = await searchPlodaiEntities({
                    farmId: state.farm.id,
                    query,
                  });
                  return response.entities as Entity[];
                },
                onRequestPreview: async (entity) => buildPlodaiEntityPreview(entity),
              }}
              farmId={state.farm?.id ?? null}
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
        </FarmSectionCard>
      </FarmMain>
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
  overflow: hidden;
`;

const FarmToolbar = styled.div`
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  gap: 0.5rem 0.65rem;
  align-items: end;

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
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 0.72rem;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const FarmDetailBody = styled.div`
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
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

const FarmDangerButton = styled(FarmSecondaryButton)`
  border-color: rgba(186, 92, 78, 0.24);
  background: rgba(255, 244, 242, 0.92);
  color: #8b3e32;
`;

const FarmEmptyState = styled.div`
  ${strongSurfaceCss};
  padding: 1rem;
  display: grid;
  gap: 0.45rem;
  min-height: 100%;
  align-content: center;
`;
