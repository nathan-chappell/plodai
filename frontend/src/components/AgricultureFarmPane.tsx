import { useEffect, useRef, useState, type FormEvent } from "react";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import { publishToast } from "../app/toasts";
import { FarmRecordPanel, type FarmRecordFocusTarget } from "./FarmRecordPanel";
import { buildFarmOrderPath } from "../lib/router";
import type {
  ApplyWorkspaceItemOperationPayload,
  FarmItemPayloadV1,
  FarmOrderStatusV1,
  FarmOrderV1,
  WorkspaceCreatedItemDetail,
  WorkspaceCreatedItemSummary,
  WorkspaceListItem,
} from "../types/workspace";

type OrderItemDraftState = {
  id: string;
  label: string;
  quantity: string;
  cropId: string;
  notes: string;
};

type OrderDraftState = {
  id: string | null;
  title: string;
  summary: string;
  priceLabel: string;
  orderUrl: string;
  status: FarmOrderStatusV1;
  notes: string;
  items: OrderItemDraftState[];
};

type AgriculturePaneSectionId = "farm" | "orders";

function createOrderItemDraft(partial: Partial<OrderItemDraftState> = {}): OrderItemDraftState {
  return {
    id: partial.id ?? crypto.randomUUID(),
    label: partial.label ?? "",
    quantity: partial.quantity ?? "",
    cropId: partial.cropId ?? "",
    notes: partial.notes ?? "",
  };
}

function createEmptyOrderDraft(): OrderDraftState {
  return {
    id: null,
    title: "",
    summary: "",
    priceLabel: "",
    orderUrl: "",
    status: "draft",
    notes: "",
    items: [createOrderItemDraft()],
  };
}

function isBlankOrderItemDraft(item: OrderItemDraftState): boolean {
  return (
    !item.label.trim() &&
    !item.quantity.trim() &&
    !item.cropId.trim() &&
    !item.notes.trim()
  );
}

function isEmptyOrderDraft(draft: OrderDraftState): boolean {
  return (
    draft.id === null &&
    draft.title.trim() === "" &&
    draft.summary.trim() === "" &&
    draft.priceLabel.trim() === "" &&
    draft.orderUrl.trim() === "" &&
    draft.status === "draft" &&
    draft.notes.trim() === "" &&
    draft.items.length === 1 &&
    isBlankOrderItemDraft(draft.items[0] ?? createOrderItemDraft())
  );
}

function hasFarmArtifactChanged(
  current: WorkspaceCreatedItemDetail | null,
  next: WorkspaceCreatedItemDetail | null,
): boolean {
  if (current === next) {
    return false;
  }
  if (current === null || next === null) {
    return current !== next;
  }
  return current.id !== next.id || current.current_revision !== next.current_revision;
}

function buildOrderDraft(order: FarmOrderV1): OrderDraftState {
  return {
    id: order.id,
    title: order.title,
    summary: order.summary ?? "",
    priceLabel: order.price_label ?? "",
    orderUrl: order.order_url ?? "",
    status: order.status,
    notes: order.notes ?? "",
    items: order.items.length
      ? order.items.map((item) =>
          createOrderItemDraft({
            id: item.id,
            label: item.label,
            quantity: item.quantity ?? "",
            cropId: item.crop_id ?? "",
            notes: item.notes ?? "",
          }),
        )
      : [createOrderItemDraft()],
  };
}

export function AgricultureFarmPane({
  activeWorkspaceId,
  activeSectionId,
  applyArtifactOperation,
  deleteArtifact,
  farmArtifactSummary,
  focusTarget,
  getArtifact,
  onCreateWorkspace,
  onSelectSection,
  onSelectWorkspace,
  selectedArtifactId,
  showSectionTabs = false,
  workspaces,
}: {
  activeWorkspaceId: string | null;
  activeSectionId: AgriculturePaneSectionId;
  applyArtifactOperation: (
    artifactId: string,
    payload: ApplyWorkspaceItemOperationPayload,
  ) => Promise<WorkspaceCreatedItemDetail>;
  deleteArtifact: (artifactId: string) => Promise<void>;
  farmArtifactSummary: WorkspaceCreatedItemSummary | null;
  focusTarget: FarmRecordFocusTarget | null;
  getArtifact: (artifactId: string) => Promise<WorkspaceCreatedItemDetail | null>;
  onCreateWorkspace: () => void;
  onSelectSection?: (sectionId: AgriculturePaneSectionId) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  selectedArtifactId: string | null;
  showSectionTabs?: boolean;
  workspaces: WorkspaceListItem[];
}) {
  const [farmArtifact, setFarmArtifact] = useState<WorkspaceCreatedItemDetail | null>(null);
  const [farmDraft, setFarmDraft] = useState({
    farmName: "",
    location: "",
  });
  const [orderDraft, setOrderDraft] = useState<OrderDraftState>(createEmptyOrderDraft);
  const [isEditingFarm, setIsEditingFarm] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [isMutatingFarm, setIsMutatingFarm] = useState(false);
  const orderRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const selectedWorkspaceId = activeWorkspaceId ?? workspaces[0]?.id ?? "";
  const farmArtifactSummaryId = farmArtifactSummary?.id ?? null;
  const farmArtifactSummaryRevision = farmArtifactSummary?.current_revision ?? null;
  const currentFarm =
    farmArtifact?.kind === "farm.v1" ? (farmArtifact.payload as FarmItemPayloadV1) : null;
  const orderCount = currentFarm?.orders?.length ?? 0;
  const orderShareUrls =
    currentFarm && typeof window !== "undefined" && selectedWorkspaceId
      ? Object.fromEntries(
          (currentFarm.orders ?? []).map((order) => [
            order.id,
            `${window.location.origin}${buildFarmOrderPath(selectedWorkspaceId, order.id)}`,
          ]),
        )
      : {};

  useEffect(() => {
    let cancelled = false;
    if (!farmArtifactSummaryId) {
      setFarmArtifact((current) => (current === null ? current : null));
      setIsEditingFarm(false);
      setIsEditingOrder(false);
      setOrderDraft((current) => (isEmptyOrderDraft(current) ? current : createEmptyOrderDraft()));
      return;
    }
    void (async () => {
      const detail = await getArtifact(farmArtifactSummaryId);
      if (!cancelled) {
        setFarmArtifact((current) =>
          hasFarmArtifactChanged(current, detail) ? detail : current,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [farmArtifactSummaryId, farmArtifactSummaryRevision, getArtifact]);

  useEffect(() => {
    if (activeSectionId !== "orders" || focusTarget?.kind !== "order") {
      return;
    }
    orderRefs.current[focusTarget.itemId]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeSectionId, focusTarget]);

  function openFarmEditor() {
    if (farmArtifact?.kind !== "farm.v1") {
      return;
    }
    setFarmDraft({
      farmName: currentFarm?.farm_name ?? "",
      location: currentFarm?.location ?? "",
    });
    setIsEditingFarm(true);
  }

  async function persistFarm(nextFarm: FarmItemPayloadV1) {
    if (!farmArtifact || farmArtifact.kind !== "farm.v1") {
      return;
    }
    setIsMutatingFarm(true);
    try {
      const nextDetail = await applyArtifactOperation(farmArtifact.id, {
        base_revision: farmArtifact.current_revision,
        operation: {
          op: "farm.set_state",
          farm_name: nextFarm.farm_name,
          location: nextFarm.location ?? null,
          crops: nextFarm.crops,
          issues: nextFarm.issues,
          projects: nextFarm.projects,
          orders: nextFarm.orders ?? [],
          current_work: nextFarm.current_work,
          notes: nextFarm.notes ?? null,
        },
      });
      setFarmArtifact(nextDetail);
      setIsEditingFarm(false);
      setIsEditingOrder(false);
    } catch (error) {
      publishToast({
        title: "Farm update failed",
        message: error instanceof Error ? error.message : "Unable to update the farm record.",
        tone: "error",
      });
    } finally {
      setIsMutatingFarm(false);
    }
  }

  async function handleFarmEditorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentFarm) {
      return;
    }
    const nextName = farmDraft.farmName.trim() || currentFarm.farm_name;
    await persistFarm({
      ...currentFarm,
      farm_name: nextName,
      location: farmDraft.location.trim() || null,
    });
  }

  async function handleDismissIssue(issueId: string) {
    if (!currentFarm) {
      return;
    }
    await persistFarm({
      ...currentFarm,
      issues: currentFarm.issues.map((issue) =>
        issue.id === issueId ? { ...issue, status: "resolved" } : issue,
      ),
    });
  }

  async function handleDismissProject(projectId: string) {
    if (!currentFarm) {
      return;
    }
    await persistFarm({
      ...currentFarm,
      projects: currentFarm.projects.map((project) =>
        project.id === projectId ? { ...project, status: "done" } : project,
      ),
    });
  }

  async function handleDeleteCrop(cropId: string) {
    if (!currentFarm) {
      return;
    }
    await persistFarm({
      ...currentFarm,
      crops: currentFarm.crops.filter((crop) => crop.id !== cropId),
    });
  }

  function openNewOrderEditor() {
    setOrderDraft(createEmptyOrderDraft());
    setIsEditingOrder(true);
  }

  function openOrderEditor(orderId: string) {
    if (!currentFarm) {
      return;
    }
    const order = (currentFarm.orders ?? []).find((candidate) => candidate.id === orderId);
    if (!order) {
      return;
    }
    setOrderDraft(buildOrderDraft(order));
    setIsEditingOrder(true);
  }

  async function handleDeleteOrder(orderId: string) {
    if (!currentFarm) {
      return;
    }
    await persistFarm({
      ...currentFarm,
      orders: (currentFarm.orders ?? []).filter((order) => order.id !== orderId),
    });
  }

  async function handleSetOrderStatus(orderId: string, status: FarmOrderStatusV1) {
    if (!currentFarm) {
      return;
    }
    await persistFarm({
      ...currentFarm,
      orders: (currentFarm.orders ?? []).map((order) =>
        order.id === orderId ? { ...order, status } : order,
      ),
    });
  }

  async function handleOrderEditorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentFarm) {
      return;
    }

    const title = orderDraft.title.trim();
    if (!title) {
      publishToast({
        title: "Order title required",
        message: "Add a title so people know what they can order.",
        tone: "error",
      });
      return;
    }

    const normalizedItems = orderDraft.items
      .map((item) => ({
        id: item.id,
        label: item.label.trim(),
        quantity: item.quantity.trim() || null,
        crop_id: item.cropId.trim() || null,
        notes: item.notes.trim() || null,
      }))
      .filter((item) => item.label);

    if (!normalizedItems.length) {
      publishToast({
        title: "Add at least one item",
        message: "Each order should include at least one product or mix line.",
        tone: "error",
      });
      return;
    }

    const nextOrder: FarmOrderV1 = {
      id: orderDraft.id ?? crypto.randomUUID(),
      title,
      status: orderDraft.status,
      summary: orderDraft.summary.trim() || null,
      price_label: orderDraft.priceLabel.trim() || null,
      order_url: orderDraft.orderUrl.trim() || null,
      notes: orderDraft.notes.trim() || null,
      items: normalizedItems,
      hero_image_file_id: null,
      hero_image_alt_text: null,
    };

    const existingOrders = currentFarm.orders ?? [];
    await persistFarm({
      ...currentFarm,
      orders: orderDraft.id
        ? existingOrders.map((order) => (order.id === orderDraft.id ? nextOrder : order))
        : [nextOrder, ...existingOrders],
    });
    setOrderDraft(createEmptyOrderDraft());
  }

  async function handleDeleteFarm() {
    if (!farmArtifact || farmArtifact.kind !== "farm.v1") {
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${farmArtifact.title || "this farm"} and clear this record?`)
    ) {
      return;
    }
    setIsMutatingFarm(true);
    try {
      await deleteArtifact(farmArtifact.id);
      setFarmArtifact(null);
      setIsEditingFarm(false);
      setIsEditingOrder(false);
      setOrderDraft(createEmptyOrderDraft());
    } catch (error) {
      publishToast({
        title: "Farm delete failed",
        message: error instanceof Error ? error.message : "Unable to delete this farm record.",
        tone: "error",
      });
    } finally {
      setIsMutatingFarm(false);
    }
  }

  const isOrdersSection = activeSectionId === "orders";

  return (
    <FarmPaneCard data-testid="agriculture-farm-pane">
      <FarmPaneHeader>
        <FarmPaneHeaderTop>
          <HeaderLabel>Farm</HeaderLabel>
          <PaneHeaderActions>
            <HeaderButton onClick={onCreateWorkspace} type="button">
              New farm
            </HeaderButton>
          </PaneHeaderActions>
        </FarmPaneHeaderTop>
        <WorkspaceSelect
          aria-label="Select farm"
          data-testid="agriculture-workspace-selector"
          onChange={(event) => {
            const nextWorkspaceId = event.target.value.trim();
            if (nextWorkspaceId) {
              onSelectWorkspace(nextWorkspaceId);
            }
          }}
          value={selectedWorkspaceId}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {formatFarmWorkspaceLabel(workspace)}
            </option>
          ))}
        </WorkspaceSelect>
      </FarmPaneHeader>

      {showSectionTabs ? (
        <PaneSectionTabs data-testid="agriculture-pane-tabs">
          <PaneSectionTabButton
            $active={!isOrdersSection}
            aria-pressed={!isOrdersSection}
            onClick={() => onSelectSection?.("farm")}
            type="button"
          >
            Farm
          </PaneSectionTabButton>
          <PaneSectionTabButton
            $active={isOrdersSection}
            aria-pressed={isOrdersSection}
            onClick={() => onSelectSection?.("orders")}
            type="button"
          >
            Orders
            <PaneSectionCount>{orderCount}</PaneSectionCount>
          </PaneSectionTabButton>
        </PaneSectionTabs>
      ) : null}

      <FarmPaneSection data-testid="agriculture-farm-record-section">
        {farmArtifact?.kind === "farm.v1" ? (
          isOrdersSection ? (
            <OrderStudioCard data-testid="agriculture-order-studio">
              <OrderStudioHeader>
                <div>
                  <OrderStudioEyebrow>Order studio</OrderStudioEyebrow>
                  <OrderStudioTitle>Build mixes and shareable offers</OrderStudioTitle>
                </div>
                <HeaderButton
                  disabled={isMutatingFarm}
                  onClick={openNewOrderEditor}
                  type="button"
                >
                  New order
                </HeaderButton>
              </OrderStudioHeader>
              <MetaText>
                Create a public order page for a seasonal pack, mixed box, or custom bundle, then
                attach your real checkout or contact link.
              </MetaText>
              {isEditingOrder ? (
                <OrderEditorForm onSubmit={(event) => void handleOrderEditorSubmit(event)}>
                  <OrderEditorGrid>
                    <FarmEditorField>
                      <span>Title</span>
                      <FarmEditorInput
                        onChange={(event) =>
                          setOrderDraft((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                        placeholder="Sataras mix"
                        type="text"
                        value={orderDraft.title}
                      />
                    </FarmEditorField>
                    <FarmEditorField>
                      <span>Price</span>
                      <FarmEditorInput
                        onChange={(event) =>
                          setOrderDraft((current) => ({
                            ...current,
                            priceLabel: event.target.value,
                          }))
                        }
                        placeholder="9 EUR"
                        type="text"
                        value={orderDraft.priceLabel}
                      />
                    </FarmEditorField>
                    <FarmEditorField>
                      <span>Status</span>
                      <OrderStatusSelect
                        onChange={(event) =>
                          setOrderDraft((current) => ({
                            ...current,
                            status: event.target.value as FarmOrderStatusV1,
                          }))
                        }
                        value={orderDraft.status}
                      >
                        <option value="draft">Draft</option>
                        <option value="live">Live</option>
                        <option value="sold_out">Sold out</option>
                      </OrderStatusSelect>
                    </FarmEditorField>
                    <FarmEditorField>
                      <span>Order link</span>
                      <FarmEditorInput
                        onChange={(event) =>
                          setOrderDraft((current) => ({
                            ...current,
                            orderUrl: event.target.value,
                          }))
                        }
                        placeholder="https://..."
                        type="url"
                        value={orderDraft.orderUrl}
                      />
                    </FarmEditorField>
                  </OrderEditorGrid>

                  <FarmEditorField>
                    <span>Summary</span>
                    <FarmEditorTextarea
                      onChange={(event) =>
                        setOrderDraft((current) => ({
                          ...current,
                          summary: event.target.value,
                        }))
                      }
                      placeholder="A ready-to-cook mix with the farm's current harvest."
                      rows={3}
                      value={orderDraft.summary}
                    />
                  </FarmEditorField>

                  <OrderEditorSection>
                    <OrderEditorSectionHeader>
                      <span>Line items</span>
                      <FarmEditorGhostButton
                        disabled={isMutatingFarm}
                        onClick={() =>
                          setOrderDraft((current) => ({
                            ...current,
                            items: [...current.items, createOrderItemDraft()],
                          }))
                        }
                        type="button"
                      >
                        Add item
                      </FarmEditorGhostButton>
                    </OrderEditorSectionHeader>
                    {currentFarm?.crops.length ? (
                      <CropQuickAddRow>
                        {currentFarm.crops.map((crop) => (
                          <CropQuickAddButton
                            key={crop.id}
                            onClick={() =>
                              setOrderDraft((current) => ({
                                ...current,
                                items: [
                                  ...current.items,
                                  createOrderItemDraft({
                                    label: crop.name,
                                    cropId: crop.id,
                                  }),
                                ],
                              }))
                            }
                            type="button"
                          >
                            Add {crop.name}
                          </CropQuickAddButton>
                        ))}
                      </CropQuickAddRow>
                    ) : null}
                    <OrderItemEditorList>
                      {orderDraft.items.map((item) => (
                        <OrderItemEditorCard key={item.id}>
                          <OrderItemEditorGrid>
                            <FarmEditorField>
                              <span>Label</span>
                              <FarmEditorInput
                                onChange={(event) =>
                                  setOrderDraft((current) => ({
                                    ...current,
                                    items: current.items.map((candidate) =>
                                      candidate.id === item.id
                                        ? { ...candidate, label: event.target.value }
                                        : candidate,
                                    ),
                                  }))
                                }
                                placeholder="Onions"
                                type="text"
                                value={item.label}
                              />
                            </FarmEditorField>
                            <FarmEditorField>
                              <span>Quantity</span>
                              <FarmEditorInput
                                onChange={(event) =>
                                  setOrderDraft((current) => ({
                                    ...current,
                                    items: current.items.map((candidate) =>
                                      candidate.id === item.id
                                        ? { ...candidate, quantity: event.target.value }
                                        : candidate,
                                    ),
                                  }))
                                }
                                placeholder="2 kg"
                                type="text"
                                value={item.quantity}
                              />
                            </FarmEditorField>
                          </OrderItemEditorGrid>
                          <OrderItemEditorGrid>
                            <FarmEditorField>
                              <span>Crop ref</span>
                              <FarmEditorInput
                                onChange={(event) =>
                                  setOrderDraft((current) => ({
                                    ...current,
                                    items: current.items.map((candidate) =>
                                      candidate.id === item.id
                                        ? { ...candidate, cropId: event.target.value }
                                        : candidate,
                                    ),
                                  }))
                                }
                                placeholder="Optional crop id"
                                type="text"
                                value={item.cropId}
                              />
                            </FarmEditorField>
                            <FarmEditorField>
                              <span>Notes</span>
                              <FarmEditorInput
                                onChange={(event) =>
                                  setOrderDraft((current) => ({
                                    ...current,
                                    items: current.items.map((candidate) =>
                                      candidate.id === item.id
                                        ? { ...candidate, notes: event.target.value }
                                        : candidate,
                                    ),
                                  }))
                                }
                                placeholder="Optional note"
                                type="text"
                                value={item.notes}
                              />
                            </FarmEditorField>
                          </OrderItemEditorGrid>
                          <FarmDangerButtonRow>
                            <FarmEditorGhostButton
                              disabled={orderDraft.items.length <= 1 || isMutatingFarm}
                              onClick={() =>
                                setOrderDraft((current) => ({
                                  ...current,
                                  items: current.items.filter((candidate) => candidate.id !== item.id),
                                }))
                              }
                              type="button"
                            >
                              Remove line
                            </FarmEditorGhostButton>
                          </FarmDangerButtonRow>
                        </OrderItemEditorCard>
                      ))}
                    </OrderItemEditorList>
                  </OrderEditorSection>

                  <FarmEditorField>
                    <span>Notes</span>
                    <FarmEditorTextarea
                      onChange={(event) =>
                        setOrderDraft((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Pickup timing, substitutions, or packaging notes."
                      rows={3}
                      value={orderDraft.notes}
                    />
                  </FarmEditorField>

                  <FarmEditorActions>
                    <FarmEditorButton disabled={isMutatingFarm} type="submit">
                      {isMutatingFarm ? "Saving..." : orderDraft.id ? "Update order" : "Save order"}
                    </FarmEditorButton>
                    <FarmEditorGhostButton
                      disabled={isMutatingFarm}
                      onClick={() => {
                        setIsEditingOrder(false);
                        setOrderDraft(createEmptyOrderDraft());
                      }}
                      type="button"
                    >
                      Cancel
                    </FarmEditorGhostButton>
                  </FarmEditorActions>
                </OrderEditorForm>
              ) : (
                <OrderStudioList>
                  {(currentFarm?.orders ?? []).length ? (
                    (currentFarm?.orders ?? []).map((order) => {
                      const shareUrl = orderShareUrls[order.id] ?? null;
                      const nextStatus = nextOrderStatus(order.status);
                      const highlighted =
                        focusTarget?.kind === "order" && focusTarget.itemId === order.id;
                      return (
                        <OrderStudioItem
                          key={order.id}
                          ref={(node) => {
                            orderRefs.current[order.id] = node;
                          }}
                          $highlighted={highlighted}
                          data-highlighted={highlighted ? "true" : undefined}
                          data-testid={`farm-order-${order.id}`}
                        >
                          <div>
                            <strong>{order.title}</strong>
                            <MetaText>
                              {[formatOrderStatus(order.status), order.price_label, shareUrl]
                                .filter(Boolean)
                                .join(" · ")}
                            </MetaText>
                            {order.summary ? <MetaText>{order.summary}</MetaText> : null}
                          </div>
                          <OrderStudioActions>
                            <FarmEditorGhostButton
                              disabled={isMutatingFarm}
                              onClick={() => openOrderEditor(order.id)}
                              type="button"
                            >
                              Edit
                            </FarmEditorGhostButton>
                            {nextStatus ? (
                              <FarmEditorGhostButton
                                disabled={isMutatingFarm}
                                onClick={() => {
                                  void handleSetOrderStatus(order.id, nextStatus);
                                }}
                                type="button"
                              >
                                {statusActionLabel(nextStatus)}
                              </FarmEditorGhostButton>
                            ) : null}
                            {shareUrl ? (
                              <FarmEditorGhostButton
                                disabled={isMutatingFarm}
                                onClick={() => {
                                  void navigator.clipboard.writeText(shareUrl);
                                  publishToast({
                                    title: "Share link copied",
                                    message: `Copied the public page for ${order.title}.`,
                                    tone: "info",
                                  });
                                }}
                                type="button"
                              >
                                Copy link
                              </FarmEditorGhostButton>
                            ) : null}
                            <FarmEditorGhostButton
                              disabled={isMutatingFarm}
                              onClick={() => {
                                void handleDeleteOrder(order.id);
                              }}
                              type="button"
                            >
                              Remove
                            </FarmEditorGhostButton>
                          </OrderStudioActions>
                        </OrderStudioItem>
                      );
                    })
                  ) : (
                    <MetaText>No order offers yet. Start with a pack, mix, or weekly box.</MetaText>
                  )}
                </OrderStudioList>
              )}
            </OrderStudioCard>
          ) : (
            <FarmRecordPanel
              dataTestId="agriculture-farm-record"
              farm={currentFarm ?? (farmArtifact.payload as FarmItemPayloadV1)}
              farmEditor={
                isEditingFarm ? (
                  <FarmEditorForm onSubmit={(event) => void handleFarmEditorSubmit(event)}>
                    <FarmEditorFields>
                      <FarmEditorField>
                        <span>Name</span>
                        <FarmEditorInput
                          onChange={(event) =>
                            setFarmDraft((current) => ({
                              ...current,
                              farmName: event.target.value,
                            }))
                          }
                          placeholder="Farm name"
                          type="text"
                          value={farmDraft.farmName}
                        />
                      </FarmEditorField>
                      <FarmEditorField>
                        <span>Location</span>
                        <FarmEditorInput
                          onChange={(event) =>
                            setFarmDraft((current) => ({
                              ...current,
                              location: event.target.value,
                            }))
                          }
                          placeholder="Location"
                          type="text"
                          value={farmDraft.location}
                        />
                      </FarmEditorField>
                    </FarmEditorFields>
                    <FarmEditorActions>
                      <FarmEditorButton disabled={isMutatingFarm} type="submit">
                        {isMutatingFarm ? "Saving..." : "Save"}
                      </FarmEditorButton>
                      <FarmEditorGhostButton
                        disabled={isMutatingFarm}
                        onClick={() => setIsEditingFarm(false)}
                        type="button"
                      >
                        Cancel
                      </FarmEditorGhostButton>
                    </FarmEditorActions>
                  </FarmEditorForm>
                ) : null
              }
              focusTarget={focusTarget}
              highlightRecord={selectedArtifactId === farmArtifact.id}
              isMutating={isMutatingFarm}
              onDeleteCrop={(cropId) => {
                void handleDeleteCrop(cropId);
              }}
              onDeleteFarm={() => {
                void handleDeleteFarm();
              }}
              onDismissIssue={(issueId) => {
                void handleDismissIssue(issueId);
              }}
              onDismissProject={(projectId) => {
                void handleDismissProject(projectId);
              }}
              onEditFarm={openFarmEditor}
              showOrdersSection={false}
            />
          )
        ) : (
          <EmptyFarmState data-testid="agriculture-farm-empty">
            <EmptyFarmTitle>No farm record saved yet</EmptyFarmTitle>
            <MetaText>
              Add crop photos in chat and the agent will assess them and keep this farm record
              updated automatically when the findings are strong enough to save.
            </MetaText>
          </EmptyFarmState>
        )}
      </FarmPaneSection>
    </FarmPaneCard>
  );
}

function formatFarmWorkspaceLabel(workspace: WorkspaceListItem): string {
  const trimmedName = workspace.name.trim();
  if (!trimmedName || trimmedName === "Workspace" || trimmedName === "Agriculture workspace") {
    return "Farm";
  }
  return trimmedName;
}

function formatOrderStatus(status: FarmOrderStatusV1): string {
  return status === "sold_out" ? "sold out" : status;
}

function nextOrderStatus(status: FarmOrderStatusV1): FarmOrderStatusV1 | null {
  if (status === "draft") {
    return "live";
  }
  if (status === "live") {
    return "sold_out";
  }
  return "live";
}

function statusActionLabel(status: FarmOrderStatusV1): string {
  if (status === "live") {
    return "Go live";
  }
  if (status === "sold_out") {
    return "Mark sold out";
  }
  return "Set draft";
}

const FarmPaneCard = styled.section`
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.72rem;
  padding: 0.82rem;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(248, 242, 235, 0.88)),
    rgba(255, 255, 255, 0.8);
  box-shadow: 0 18px 44px rgba(32, 26, 20, 0.08);
  overflow: hidden;
`;

const FarmPaneHeader = styled.div`
  flex: 0 0 auto;
  display: grid;
  gap: 0.55rem;
`;

const FarmPaneHeaderTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
`;

const HeaderLabel = styled.div`
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--accent-deep) 72%, var(--ink) 28%);
`;

const WorkspaceSelect = styled.select`
  width: 100%;
  max-width: 100%;
  border-radius: 14px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.86);
  color: var(--ink);
  padding: 0.58rem 0.72rem;
  font: inherit;
  font-size: 0.76rem;
`;

const PaneHeaderActions = styled.div`
  display: flex;
  gap: 0.45rem;
`;

const HeaderButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.76);
  color: var(--ink);
  border-radius: 999px;
  padding: 0.42rem 0.72rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
`;

const FarmPaneSection = styled.section`
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
`;

const PaneSectionTabs = styled.div`
  display: inline-flex;
  gap: 0.45rem;
`;

const PaneSectionTabButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? "color-mix(in srgb, var(--accent-deep) 26%, rgba(31, 41, 55, 0.12))"
        : "rgba(31, 41, 55, 0.12)"};
  background: ${({ $active }) =>
    $active
      ? "color-mix(in srgb, rgba(117, 158, 126, 0.16) 55%, white 45%)"
      : "rgba(255, 255, 255, 0.82)"};
  color: var(--ink);
  border-radius: 999px;
  padding: 0.4rem 0.78rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
`;

const PaneSectionCount = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.4rem;
  height: 1.4rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  font-size: 0.68rem;
  font-weight: 800;
`;

const EmptyFarmState = styled.div`
  display: grid;
  align-content: center;
  gap: 0.45rem;
  min-height: 100%;
  padding: 1rem 1.05rem;
  border-radius: 1rem;
  border: 1px dashed rgba(101, 144, 115, 0.22);
  background: rgba(255, 255, 255, 0.74);
`;

const EmptyFarmTitle = styled.h4`
  margin: 0;
  font-size: 0.96rem;
  color: color-mix(in srgb, var(--accent-deep) 78%, var(--ink) 22%);
`;

const FarmEditorForm = styled.form`
  display: grid;
  gap: 0.75rem;
`;

const FarmEditorFields = styled.div`
  display: grid;
  gap: 0.6rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
`;

const FarmEditorField = styled.label`
  display: grid;
  gap: 0.28rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--muted);
`;

const FarmEditorInput = styled.input`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  border-radius: 0.8rem;
  padding: 0.56rem 0.7rem;
  font: inherit;
  font-size: 0.82rem;
`;

const FarmEditorTextarea = styled.textarea`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  border-radius: 0.8rem;
  padding: 0.62rem 0.7rem;
  font: inherit;
  font-size: 0.82rem;
  resize: vertical;
`;

const FarmEditorActions = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const FarmEditorButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(36, 57, 42, 0.92);
  color: #fffaf4;
  border-radius: 999px;
  padding: 0.42rem 0.78rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.58;
  }
`;

const FarmEditorGhostButton = styled(FarmEditorButton)`
  background: rgba(255, 255, 255, 0.82);
  color: var(--ink);
`;

const OrderStudioCard = styled.section`
  display: grid;
  gap: 0.85rem;
  padding: 1rem;
  border-radius: 1rem;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background:
    linear-gradient(135deg, rgba(236, 221, 184, 0.42), rgba(255, 255, 255, 0.92)),
    rgba(255, 255, 255, 0.82);
`;

const OrderStudioHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
`;

const OrderStudioEyebrow = styled.div`
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, #7a4b18 76%, var(--ink) 24%);
`;

const OrderStudioTitle = styled.h4`
  margin: 0.2rem 0 0;
  font-size: 1rem;
  line-height: 1.1;
`;

const OrderEditorForm = styled.form`
  display: grid;
  gap: 0.8rem;
`;

const OrderEditorGrid = styled.div`
  display: grid;
  gap: 0.65rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
`;

const OrderItemEditorGrid = styled(OrderEditorGrid)`
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
`;

const OrderStatusSelect = styled.select`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  border-radius: 0.8rem;
  padding: 0.56rem 0.7rem;
  font: inherit;
  font-size: 0.82rem;
`;

const OrderEditorSection = styled.section`
  display: grid;
  gap: 0.7rem;
`;

const OrderEditorSectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.74rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
`;

const CropQuickAddRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
`;

const CropQuickAddButton = styled.button`
  border: 1px solid rgba(101, 144, 115, 0.18);
  background: rgba(255, 255, 255, 0.78);
  color: var(--ink);
  border-radius: 999px;
  padding: 0.34rem 0.64rem;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
`;

const OrderItemEditorList = styled.div`
  display: grid;
  gap: 0.65rem;
`;

const OrderItemEditorCard = styled.div`
  display: grid;
  gap: 0.6rem;
  padding: 0.8rem;
  border-radius: 0.9rem;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.84);
`;

const FarmDangerButtonRow = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const OrderStudioList = styled.div`
  display: grid;
  gap: 0.6rem;
`;

const OrderStudioItem = styled.div<{ $highlighted: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.72rem 0.8rem;
  border-radius: 0.9rem;
  background: ${({ $highlighted }) =>
    $highlighted
      ? "rgba(220, 245, 224, 0.96)"
      : "rgba(255, 255, 255, 0.76)"};
  border: 1px solid
    ${({ $highlighted }) =>
      $highlighted
        ? "rgba(101, 144, 115, 0.28)"
        : "rgba(31, 41, 55, 0.08)"};
  box-shadow: ${({ $highlighted }) =>
    $highlighted ? "0 0 0 3px rgba(117, 158, 126, 0.12)" : "none"};

  strong {
    display: block;
    margin-bottom: 0.18rem;
    font-size: 0.88rem;
  }
`;

const OrderStudioActions = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.5rem;
`;
