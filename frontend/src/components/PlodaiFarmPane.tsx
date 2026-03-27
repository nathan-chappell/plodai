import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import type { Entity } from "@openai/chatkit";

import { MetaText, sectionPanelCss, secondaryButtonCss, strongSurfaceCss } from "../app/styles";
import { useMediaQuery } from "../app/hooks";
import { useAppState } from "../app/context";
import { publishToast } from "../app/toasts";
import { AuthPanel } from "./AuthPanel";
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
import { COMPACT_CHAT_SURFACE_MIN_HEIGHT, COMPACT_WORKSPACE_MEDIA_QUERY } from "../lib/responsive";
import { UNNAMED_FARM_LABEL, getFarmDisplayName, normalizeFarmPayload } from "../lib/farm";
import { buildPlodaiEntityPreview } from "../lib/plodai-entities";
import { ADMIN_USERS_PATH, PLODAI_PATH, navigate } from "../lib/router";
import type { FarmDetail, FarmRecordPayload, FarmSummary } from "../types/farm";

type LoadState = {
  farms: FarmSummary[];
  farm: FarmDetail | null;
  record: FarmRecordPayload | null;
};

type FarmWorkspacePane = "farm" | "overview" | "chat";
const COMPACT_PANES: ReadonlyArray<{
  id: FarmWorkspacePane;
  label: string;
}> = [
  {
    id: "farm",
    label: "Farm",
  },
  {
    id: "overview",
    label: "Overview",
  },
  {
    id: "chat",
    label: "Chat",
  },
];

export function PlodaiFarmPane() {
  const {
    preferredOutputLanguage,
    setPreferredOutputLanguage,
    user,
  } = useAppState();
  const [state, setState] = useState<LoadState>({
    farms: [],
    farm: null,
    record: null,
  });
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [activeCompactPane, setActiveCompactPane] = useState<FarmWorkspacePane>("overview");
  const isCompactLayout = useMediaQuery(COMPACT_WORKSPACE_MEDIA_QUERY);
  const selectedFarmIdRef = useRef<string | null>(selectedFarmId);
  const farmLoadRequestIdRef = useRef(0);
  const compactTrackRef = useRef<HTMLDivElement | null>(null);
  const compactPaneRefs = useRef<Record<FarmWorkspacePane, HTMLElement | null>>({
    farm: null,
    overview: null,
    chat: null,
  });
  const compactTrackFrameRef = useRef<number | null>(null);

  useEffect(() => {
    selectedFarmIdRef.current = selectedFarmId;
  }, [selectedFarmId]);

  useEffect(() => {
    return () => {
      if (
        compactTrackFrameRef.current !== null &&
        typeof window !== "undefined"
      ) {
        window.cancelAnimationFrame(compactTrackFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isCompactLayout) {
      return;
    }

    compactPaneRefs.current[activeCompactPane]?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "start",
    });
  }, [isCompactLayout]);

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
      setActiveCompactPane("overview");
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

  function handleCompactPaneSelect(pane: FarmWorkspacePane) {
    setActiveCompactPane(pane);
    compactPaneRefs.current[pane]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "start",
    });
  }

  function syncCompactPaneFromScroll() {
    const track = compactTrackRef.current;
    if (!track) {
      return;
    }

    const nextPaneIndex = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
    const nextPane = COMPACT_PANES[nextPaneIndex]?.id;
    if (!nextPane) {
      return;
    }

    setActiveCompactPane((current) => (current === nextPane ? current : nextPane));
  }

  function handleCompactTrackScroll() {
    if (typeof window === "undefined") {
      return;
    }
    if (compactTrackFrameRef.current !== null) {
      return;
    }

    compactTrackFrameRef.current = window.requestAnimationFrame(() => {
      compactTrackFrameRef.current = null;
      syncCompactPaneFromScroll();
    });
  }

  const farmToolbar = (
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
        <FarmDangerButton
          disabled={mutating || !state.farm}
          onClick={() => void handleDeleteFarm()}
          type="button"
        >
          Delete farm
        </FarmDangerButton>
        <FarmPrimaryButton
          disabled={mutating}
          onClick={() => void handleCreateFarm()}
          type="button"
        >
          New farm
        </FarmPrimaryButton>
      </FarmToolbarActions>
    </FarmToolbar>
  );

  const compactWorkspaceControls = isCompactLayout ? (
    <CompactUtilityCard>
      <CompactUtilityCluster>
        <CompactUtilityLabel>Workspace</CompactUtilityLabel>
        <CompactUtilityRow>
          <CompactUtilityButton
            $active
            onClick={() => navigate(PLODAI_PATH)}
            type="button"
          >
            Farms
          </CompactUtilityButton>
          {user?.role === "admin" ? (
            <CompactUtilityButton
              $active={false}
              onClick={() => navigate(ADMIN_USERS_PATH)}
              type="button"
            >
              Admin
            </CompactUtilityButton>
          ) : null}
        </CompactUtilityRow>
      </CompactUtilityCluster>

      <CompactUtilityCluster>
        <CompactUtilityLabel>Reply language</CompactUtilityLabel>
        <CompactLanguageToggle aria-label="Preferred reply language">
          <CompactLanguageButton
            $active={preferredOutputLanguage === "hr"}
            onClick={() => setPreferredOutputLanguage("hr")}
            type="button"
          >
            HR
          </CompactLanguageButton>
          <CompactLanguageButton
            $active={preferredOutputLanguage === "en"}
            onClick={() => setPreferredOutputLanguage("en")}
            type="button"
          >
            EN
          </CompactLanguageButton>
        </CompactLanguageToggle>
      </CompactUtilityCluster>

      <CompactAccountWrap>
        <AuthPanel
          compact
          heading="Account"
          mode="account"
        />
      </CompactAccountWrap>
    </CompactUtilityCard>
  ) : null;

  const farmSummaryContent = loading ? (
    <FarmEmptyState>
      <strong>Loading farm</strong>
      <MetaText>Pulling the current farm record, field-photo context, and chat state.</MetaText>
    </FarmEmptyState>
  ) : !state.farm || !state.record ? (
    <FarmEmptyState>
      <strong>No farm selected</strong>
      <MetaText>Create a farm or choose one from the farm pane to open PlodAI.</MetaText>
    </FarmEmptyState>
  ) : (
    <FarmRecordPanel
      dataTestId="farm-management-summary"
      farm={state.record}
      isMutating={mutating}
      showAreasSection={false}
      showCropsSection={false}
      showDescriptionSection={false}
      showOrderMetric={false}
      showOrdersSection={false}
      showWorkItemsSection={false}
    />
  );

  const overviewContent = loading ? (
    <FarmEmptyState>
      <strong>Loading farm</strong>
      <MetaText>Pulling the current farm record, field-photo context, and chat state.</MetaText>
    </FarmEmptyState>
  ) : !state.farm || !state.record ? (
    <FarmEmptyState>
      <strong>No farm selected</strong>
      <MetaText>Create a farm or choose one from the farm pane to open PlodAI.</MetaText>
    </FarmEmptyState>
  ) : (
    <FarmRecordPanel
      farm={state.record}
      isMutating={mutating}
      onDeleteCrop={(cropId) => void handleDeleteCrop(cropId)}
      showDescriptionSection={isCompactLayout}
      showOrderMetric={false}
      showOrdersSection={false}
      showSummarySection={!isCompactLayout}
    />
  );

  const chatPane = (
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
      fillAvailableHeight={isCompactLayout}
      preferredOutputLanguage={preferredOutputLanguage}
      surfaceMinHeight={isCompactLayout ? COMPACT_CHAT_SURFACE_MIN_HEIGHT : undefined}
    />
  );

  return (
    <FarmWorkspaceGrid>
      <FarmMain>
        <FarmSectionCard>
          {isCompactLayout ? (
            <CompactWorkspace data-testid="compact-farm-workspace">
              <CompactPaneTabs aria-label="Farm workspace panes" role="tablist">
                {COMPACT_PANES.map((pane) => (
                  <CompactPaneTabButton
                    key={pane.id}
                    aria-controls={`farm-workspace-pane-${pane.id}`}
                    aria-selected={activeCompactPane === pane.id}
                    id={`farm-workspace-tab-${pane.id}`}
                    onClick={() => handleCompactPaneSelect(pane.id)}
                    role="tab"
                    type="button"
                  >
                    {pane.label}
                  </CompactPaneTabButton>
                ))}
              </CompactPaneTabs>

              <CompactPaneTrack
                ref={compactTrackRef}
                data-testid="compact-farm-pane-track"
                onScroll={handleCompactTrackScroll}
              >
                <CompactPaneSlide
                  ref={(node) => {
                    compactPaneRefs.current.farm = node;
                  }}
                  aria-labelledby="farm-workspace-tab-farm"
                  id="farm-workspace-pane-farm"
                  role="tabpanel"
                >
                  <CompactFarmPaneCard>
                    {compactWorkspaceControls}
                    {farmToolbar}
                    {farmSummaryContent}
                  </CompactFarmPaneCard>
                </CompactPaneSlide>

                <CompactPaneSlide
                  ref={(node) => {
                    compactPaneRefs.current.overview = node;
                  }}
                  aria-labelledby="farm-workspace-tab-overview"
                  id="farm-workspace-pane-overview"
                  role="tabpanel"
                >
                  {overviewContent}
                </CompactPaneSlide>

                <CompactPaneSlide
                  ref={(node) => {
                    compactPaneRefs.current.chat = node;
                  }}
                  aria-labelledby="farm-workspace-tab-chat"
                  id="farm-workspace-pane-chat"
                  role="tabpanel"
                >
                  {chatPane}
                </CompactPaneSlide>
              </CompactPaneTrack>
            </CompactWorkspace>
          ) : (
            <FarmPaneGrid>
              <FarmDetailPane>
                {farmToolbar}
                <FarmDetailBody>{overviewContent}</FarmDetailBody>
              </FarmDetailPane>

              {chatPane}
            </FarmPaneGrid>
          )}
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
  min-width: 0;
  height: 100%;

  @media (max-width: 1180px) {
    height: auto;
  }
`;

const FarmMain = styled.div`
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  gap: 0.9rem;
  min-width: 0;
  min-height: 0;
  height: 100%;
  align-content: stretch;

  @media (max-width: 1180px) {
    grid-template-rows: auto;
    height: auto;
    align-content: start;
  }
`;

const FarmSectionCard = styled.section`
  ${sectionPanelCss("1rem", "0.9rem")};
  display: grid;
  align-content: stretch;
  min-height: 0;
  min-width: 0;
  height: 100%;
  overflow: hidden;

  @media (max-width: 1180px) {
    height: auto;
    overflow: visible;
  }
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

const CompactWorkspace = styled.div`
  display: grid;
  gap: 0.72rem;
  min-width: 0;
`;

const CompactPaneTabs = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.18rem;
  width: 100%;
  padding: 0.16rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(249, 246, 241, 0.88);
`;

const CompactPaneTabButton = styled.button`
  appearance: none;
  border: 0;
  border-radius: 999px;
  min-height: 2rem;
  padding: 0.24rem 0.62rem;
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

const CompactPaneTrack = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 0;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scroll-behavior: smooth;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const CompactPaneSlide = styled.section`
  flex: 0 0 100%;
  min-width: 100%;
  height: calc(100dvh - 12.5rem);
  scroll-snap-align: start;
  scroll-snap-stop: always;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;

  @media (max-width: 760px) {
    height: calc(100dvh - 11.5rem);
  }
`;

const CompactFarmPaneCard = styled.section`
  ${sectionPanelCss("0.72rem", "0.72rem")};
  min-width: 0;
`;

const CompactUtilityCard = styled.section`
  display: grid;
  gap: 0.7rem;
  padding: 0.78rem 0.82rem;
  border-radius: 1rem;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background:
    linear-gradient(145deg, rgba(255, 252, 247, 0.98), rgba(248, 244, 238, 0.92)),
    rgba(255, 255, 255, 0.86);
`;

const CompactUtilityCluster = styled.div`
  display: grid;
  gap: 0.28rem;
`;

const CompactUtilityLabel = styled.div`
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-deep);
  opacity: 0.86;
`;

const CompactUtilityRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
`;

const CompactUtilityButton = styled.button<{ $active: boolean }>`
  appearance: none;
  border: 1px solid ${({ $active }) => ($active ? "rgba(21, 128, 61, 0.28)" : "var(--line)")};
  background: ${({ $active }) => ($active ? "rgba(21, 128, 61, 0.12)" : "rgba(255, 255, 255, 0.74)")};
  color: ${({ $active }) => ($active ? "var(--accent-deep)" : "var(--ink)")};
  border-radius: 999px;
  min-height: 1.9rem;
  padding: 0.22rem 0.7rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
`;

const CompactLanguageToggle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.14rem;
  width: fit-content;
  padding: 0.14rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.78);
`;

const CompactLanguageButton = styled.button<{ $active: boolean }>`
  appearance: none;
  border: 0;
  border-radius: 999px;
  min-width: 2.35rem;
  min-height: 1.95rem;
  padding: 0.2rem 0.56rem;
  background: ${({ $active }) => ($active ? "rgba(21, 128, 61, 0.12)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--accent-deep)" : "var(--muted)")};
  font: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  line-height: 1;
  cursor: pointer;
`;

const CompactAccountWrap = styled.div`
  min-width: 0;

  > section {
    width: 100%;
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
`;

const FarmDetailPane = styled.section`
  ${sectionPanelCss("0.72rem", "0.72rem")};
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const FarmDetailBody = styled.div`
  min-height: 0;
  min-width: 0;
  display: block;
  overflow: auto;
  overscroll-behavior: contain;
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
