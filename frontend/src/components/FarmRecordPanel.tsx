import { useEffect, useRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import type {
  FarmOrderStatus,
  FarmRecordPayload,
  FarmWorkItemSeverity,
} from "../types/farm";
import {
  formatFarmCropStatus,
  formatFarmCropType,
  formatFarmWorkItemKind,
  formatFarmWorkItemStatus,
  getAreaNamesForIds,
  getFarmDisplayName,
  normalizeFarmPayload,
  summarizeFarmCropWorkItems,
} from "../lib/farm";

export type FarmRecordFocusTarget =
  | { kind: "record" }
  | { kind: "crop"; itemId: string }
  | { kind: "order"; itemId: string };

export function FarmRecordPanel({
  farm,
  focusTarget = null,
  highlightRecord = false,
  dataTestId = "farm-preview",
  farmEditor = null,
  onDeleteCrop,
  onDeleteFarm,
  onDeleteOrder,
  onEditFarm,
  onEditOrder,
  onSetOrderStatus,
  orderShareUrls,
  showAreasSection = true,
  showCropsSection = true,
  showWorkItemsSection = true,
  showOrdersSection = true,
  showDescriptionSection = true,
  showSummarySection = true,
  showOrderMetric = true,
  isMutating = false,
}: {
  farm: FarmRecordPayload;
  focusTarget?: FarmRecordFocusTarget | null;
  highlightRecord?: boolean;
  dataTestId?: string;
  farmEditor?: ReactNode;
  onDeleteCrop?: (cropId: string) => void;
  onDeleteFarm?: () => void;
  onDeleteOrder?: (orderId: string) => void;
  onEditFarm?: () => void;
  onEditOrder?: (orderId: string) => void;
  onSetOrderStatus?: (orderId: string, status: FarmOrderStatus) => void;
  orderShareUrls?: Record<string, string>;
  showAreasSection?: boolean;
  showCropsSection?: boolean;
  showWorkItemsSection?: boolean;
  showOrdersSection?: boolean;
  showDescriptionSection?: boolean;
  showSummarySection?: boolean;
  showOrderMetric?: boolean;
  isMutating?: boolean;
}) {
  const normalizedFarm = normalizeFarmPayload(farm);
  const recordRef = useRef<HTMLElement | null>(null);
  const cropRefs = useRef<Record<string, HTMLElement | null>>({});
  const orderRefs = useRef<Record<string, HTMLElement | null>>({});
  const orders = normalizedFarm.orders;
  const recordHighlighted = highlightRecord || focusTarget?.kind === "record";

  useEffect(() => {
    if (!focusTarget) {
      return;
    }

    let target = recordRef.current;
    if (focusTarget.kind === "crop") {
      target = cropRefs.current[focusTarget.itemId] ?? recordRef.current;
    } else if (focusTarget.kind === "order") {
      target = orderRefs.current[focusTarget.itemId] ?? recordRef.current;
    }

    target?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [focusTarget]);

  const cropNamesById = new Map(normalizedFarm.crops.map((crop) => [crop.id, crop.name] as const));
  const areaNamesById = new Map(normalizedFarm.areas.map((area) => [area.id, area.name] as const));

  return (
    <FarmPreview
      ref={recordRef}
      $highlighted={recordHighlighted}
      data-highlighted={recordHighlighted ? "true" : undefined}
      data-testid={dataTestId}
    >
      {showSummarySection ? (
        <FarmHero>
          <FarmHeroHeader>
            <FarmHeroMain>
              <FarmEyebrow>Farm</FarmEyebrow>
              {farmEditor ? (
                <FarmEditorWrap>{farmEditor}</FarmEditorWrap>
              ) : (
                <>
                  <FarmTitleRow>
                    <FarmTitle>{getFarmDisplayName(normalizedFarm.farm_name)}</FarmTitle>
                    {normalizedFarm.location ? (
                      <FarmLocation>{normalizedFarm.location}</FarmLocation>
                    ) : null}
                  </FarmTitleRow>
                  {normalizedFarm.description ? (
                    <FarmDescription>{normalizedFarm.description}</FarmDescription>
                  ) : null}
                  <FarmMetrics>
                    <FarmMetric>
                      <strong>{normalizedFarm.areas.length}</strong>
                      <span>Areas</span>
                    </FarmMetric>
                    <FarmMetric>
                      <strong>{normalizedFarm.crops.length}</strong>
                      <span>Crops</span>
                    </FarmMetric>
                    <FarmMetric>
                      <strong>{normalizedFarm.work_items.length}</strong>
                      <span>Work items</span>
                    </FarmMetric>
                    {showOrderMetric ? (
                      <FarmMetric>
                        <strong>{orders.length}</strong>
                        <span>Orders</span>
                      </FarmMetric>
                    ) : null}
                  </FarmMetrics>
                </>
              )}
            </FarmHeroMain>
            {!farmEditor ? (
              <FarmTitleActions>
                {onEditFarm ? (
                  <FarmActionButton
                    data-testid="farm-edit-button"
                    disabled={isMutating}
                    onClick={onEditFarm}
                    type="button"
                  >
                    Edit
                  </FarmActionButton>
                ) : null}
                {onDeleteFarm ? (
                  <FarmDangerButton
                    data-testid="farm-delete-button"
                    disabled={isMutating}
                    onClick={onDeleteFarm}
                    type="button"
                  >
                    Delete
                  </FarmDangerButton>
                ) : null}
              </FarmTitleActions>
            ) : null}
          </FarmHeroHeader>
        </FarmHero>
      ) : null}

      {showAreasSection ? (
        <FarmSection>
          <FarmSectionTitle>Areas</FarmSectionTitle>
          {normalizedFarm.areas.length ? (
            <AreaList>
              {normalizedFarm.areas.map((area) => (
                <AreaCard key={area.id} data-testid={`farm-area-${area.id}`}>
                  <AreaHeader>
                    <FarmCardTitle>{area.name}</FarmCardTitle>
                    {area.kind ? <SubtlePill>{area.kind}</SubtlePill> : null}
                  </AreaHeader>
                  {area.description ? <MetaText>{area.description}</MetaText> : null}
                </AreaCard>
              ))}
            </AreaList>
          ) : (
            <MetaText>No areas saved yet.</MetaText>
          )}
        </FarmSection>
      ) : null}

      {showCropsSection ? (
        <FarmSection>
          <FarmSectionTitle>Crops</FarmSectionTitle>
          {normalizedFarm.crops.length ? (
            <CropList>
              {normalizedFarm.crops.map((crop) => {
                const highlighted =
                  focusTarget?.kind === "crop" && focusTarget.itemId === crop.id;
                const linkedAreaNames = getAreaNamesForIds(normalizedFarm, crop.area_ids);
                const workItemSummary = summarizeFarmCropWorkItems(
                  normalizedFarm,
                  crop.id,
                );

                return (
                  <CropCard
                    key={crop.id}
                    ref={(node) => {
                      cropRefs.current[crop.id] = node;
                    }}
                    $highlighted={highlighted}
                    data-highlighted={highlighted ? "true" : undefined}
                    data-testid={`farm-crop-${crop.id}`}
                  >
                    <FarmCardHeader>
                      <div>
                        <CropName>{crop.name}</CropName>
                        <CropMetaRow>
                          {crop.type ? (
                            <SubtlePill>{formatFarmCropType(crop.type)?.trim() || crop.type}</SubtlePill>
                          ) : null}
                          {crop.status ? (
                            <FarmStatusPill $tone={crop.status}>
                              {formatFarmCropStatus(crop.status) ?? crop.status}
                            </FarmStatusPill>
                          ) : null}
                        </CropMetaRow>
                      </div>
                      {onDeleteCrop ? (
                        <CropDeleteButton
                          aria-label={`Delete ${crop.name}`}
                          data-testid={`farm-delete-crop-${crop.id}`}
                          disabled={isMutating}
                          onClick={() => onDeleteCrop(crop.id)}
                          type="button"
                        >
                          x
                        </CropDeleteButton>
                      ) : null}
                    </FarmCardHeader>

                    <CropDetailGrid>
                      <CropDetailItem>
                        <CropDetailLabel>Quantity</CropDetailLabel>
                        <CropDetailValue>{crop.quantity?.trim() || "-"}</CropDetailValue>
                      </CropDetailItem>
                      <CropDetailItem>
                        <CropDetailLabel>Expected yield</CropDetailLabel>
                        <CropDetailValue>{crop.expected_yield?.trim() || "-"}</CropDetailValue>
                      </CropDetailItem>
                      <CropDetailItem>
                        <CropDetailLabel>Areas</CropDetailLabel>
                        <CropDetailValue>{linkedAreaNames.join(", ") || "-"}</CropDetailValue>
                      </CropDetailItem>
                    </CropDetailGrid>

                    {workItemSummary.workItemCount ? (
                      <CropWorkItemSummary data-testid={`farm-crop-work-items-preview-${crop.id}`}>
                        <CropIssueSummaryRow>
                          <strong>
                            {workItemSummary.workItemCount} work item
                            {workItemSummary.workItemCount === 1 ? "" : "s"}
                          </strong>
                          {workItemSummary.highestSeverity ? (
                            <IssueSeverityPill $severity={workItemSummary.highestSeverity}>
                              {workItemSummary.highestSeverity}
                            </IssueSeverityPill>
                          ) : null}
                        </CropIssueSummaryRow>
                        {workItemSummary.nextDueAt ? (
                          <CropIssueDeadline>
                            Next due: {workItemSummary.nextDueAt}
                          </CropIssueDeadline>
                        ) : null}
                        <CropIssuePreviewList>
                          {workItemSummary.titles.slice(0, 2).join(" · ")}
                        </CropIssuePreviewList>
                      </CropWorkItemSummary>
                    ) : (
                      <MetaText>No linked work items.</MetaText>
                    )}

                    {crop.notes ? <CropNotesText>{crop.notes}</CropNotesText> : null}
                  </CropCard>
                );
              })}
            </CropList>
          ) : (
            <MetaText>No crops tracked yet.</MetaText>
          )}
        </FarmSection>
      ) : null}

      {showWorkItemsSection ? (
        <FarmSection>
          <FarmSectionTitle>Work Items</FarmSectionTitle>
          {normalizedFarm.work_items.length ? (
            <WorkItemList>
              {normalizedFarm.work_items.map((workItem) => {
                const relatedCropNames = getNamesByIds(
                  workItem.related_crop_ids,
                  cropNamesById,
                );
                const relatedAreaNames = getNamesByIds(
                  workItem.related_area_ids,
                  areaNamesById,
                );
                return (
                  <WorkItemCard
                    key={workItem.id}
                    data-testid={`farm-work-item-${workItem.id}`}
                  >
                    <FarmCardHeader>
                      <div>
                        <FarmCardTitle>{workItem.title}</FarmCardTitle>
                        <WorkItemMetaRow>
                          <SubtlePill>
                            {formatFarmWorkItemKind(workItem.kind) ?? workItem.kind}
                          </SubtlePill>
                          {workItem.status ? (
                            <FarmStatusPill $tone={workItem.status}>
                              {formatFarmWorkItemStatus(workItem.status) ?? workItem.status}
                            </FarmStatusPill>
                          ) : null}
                          {workItem.severity ? (
                            <IssueSeverityPill $severity={workItem.severity}>
                              {workItem.severity}
                            </IssueSeverityPill>
                          ) : null}
                        </WorkItemMetaRow>
                      </div>
                    </FarmCardHeader>
                    {workItem.observed_at || workItem.due_at ? (
                      <WorkItemTimeline>
                        {workItem.observed_at ? `Observed: ${workItem.observed_at}` : null}
                        {workItem.observed_at && workItem.due_at ? " | " : null}
                        {workItem.due_at ? `Due: ${workItem.due_at}` : null}
                      </WorkItemTimeline>
                    ) : null}
                    {workItem.description ? (
                      <WorkItemMarkdown>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {workItem.description}
                        </ReactMarkdown>
                      </WorkItemMarkdown>
                    ) : null}
                    {workItem.recommended_follow_up ? (
                      <IssueFollowUp>
                        <strong>Follow-up:</strong> {workItem.recommended_follow_up}
                      </IssueFollowUp>
                    ) : null}
                    {relatedCropNames.length ||
                    relatedAreaNames.length ||
                    workItem.related_image_ids.length ? (
                      <WorkItemRelations>
                        {relatedCropNames.length ? (
                          <RelationText>
                            <strong>Crops:</strong> {relatedCropNames.join(", ")}
                          </RelationText>
                        ) : null}
                        {relatedAreaNames.length ? (
                          <RelationText>
                            <strong>Areas:</strong> {relatedAreaNames.join(", ")}
                          </RelationText>
                        ) : null}
                        {workItem.related_image_ids.length ? (
                          <RelationText>
                            <strong>Images:</strong> {workItem.related_image_ids.length}
                          </RelationText>
                        ) : null}
                      </WorkItemRelations>
                    ) : null}
                  </WorkItemCard>
                );
              })}
            </WorkItemList>
          ) : (
            <MetaText>No work items saved yet.</MetaText>
          )}
        </FarmSection>
      ) : null}

      {showOrdersSection ? (
        <FarmSection>
          <FarmSectionTitle>Orders</FarmSectionTitle>
          {orders.length ? (
            <OrderList>
              {orders.map((order) => {
                const highlighted =
                  focusTarget?.kind === "order" && focusTarget.itemId === order.id;
                const nextStatus = nextOrderStatus(order.status);
                const shareUrl = orderShareUrls?.[order.id] ?? null;
                return (
                  <OrderCard
                    key={order.id}
                    ref={(node) => {
                      orderRefs.current[order.id] = node;
                    }}
                    $highlighted={highlighted}
                    data-highlighted={highlighted ? "true" : undefined}
                    data-testid={`farm-order-${order.id}`}
                  >
                    <FarmCardHeader>
                      <div>
                        <FarmCardTitle>{order.title}</FarmCardTitle>
                        <OrderMetaRow>
                          <FarmStatusPill $tone={order.status}>
                            {formatOrderStatus(order.status)}
                          </FarmStatusPill>
                          {order.price_label ? <OrderPrice>{order.price_label}</OrderPrice> : null}
                        </OrderMetaRow>
                      </div>
                      <OrderActionStack>
                        {onEditOrder ? (
                          <FarmSecondaryButton
                            disabled={isMutating}
                            onClick={() => onEditOrder(order.id)}
                            type="button"
                          >
                            Edit
                          </FarmSecondaryButton>
                        ) : null}
                        {onSetOrderStatus && nextStatus ? (
                          <FarmActionButton
                            disabled={isMutating}
                            onClick={() => onSetOrderStatus(order.id, nextStatus)}
                            type="button"
                          >
                            {statusActionLabel(nextStatus)}
                          </FarmActionButton>
                        ) : null}
                        {onDeleteOrder ? (
                          <FarmDangerButton
                            data-testid={`farm-delete-order-${order.id}`}
                            disabled={isMutating}
                            onClick={() => onDeleteOrder(order.id)}
                            type="button"
                          >
                            Remove
                          </FarmDangerButton>
                        ) : null}
                      </OrderActionStack>
                    </FarmCardHeader>
                    {order.summary ? <OrderSummary>{order.summary}</OrderSummary> : null}
                    {order.items.length ? (
                      <OrderItemList>
                        {order.items.map((item) => (
                          <OrderItemRow key={item.id}>
                            <strong>{item.label}</strong>
                            {item.quantity ? <span>{item.quantity}</span> : null}
                          </OrderItemRow>
                        ))}
                      </OrderItemList>
                    ) : (
                      <MetaText>No order line items saved.</MetaText>
                    )}
                    {order.notes ? <MetaText>{order.notes}</MetaText> : null}
                    <OrderLinkRow>
                      {shareUrl ? (
                        <OrderLink href={shareUrl} rel="noreferrer" target="_blank">
                          Public page
                        </OrderLink>
                      ) : null}
                      {isAbsoluteHttpUrl(order.order_url) ? (
                        <OrderLink href={order.order_url} rel="noreferrer" target="_blank">
                          Order link
                        </OrderLink>
                      ) : null}
                    </OrderLinkRow>
                  </OrderCard>
                );
              })}
            </OrderList>
          ) : (
            <MetaText>No order offers saved yet.</MetaText>
          )}
        </FarmSection>
      ) : null}

      {showDescriptionSection ? (
        <FarmSection>
          <FarmSectionTitle>Description</FarmSectionTitle>
          {normalizedFarm.description?.trim() ? (
            <MetaText>{normalizedFarm.description}</MetaText>
          ) : (
            <MetaText>No farm summary yet.</MetaText>
          )}
        </FarmSection>
      ) : null}
    </FarmPreview>
  );
}

function getNamesByIds(
  ids: readonly string[],
  namesById: ReadonlyMap<string, string>,
): string[] {
  return ids
    .map((id) => namesById.get(id)?.trim() ?? "")
    .filter((value) => value.length > 0);
}

function formatOrderStatus(status: FarmOrderStatus): string {
  return status === "sold_out" ? "sold out" : status;
}

function nextOrderStatus(status: FarmOrderStatus): FarmOrderStatus | null {
  if (status === "draft") {
    return "live";
  }
  if (status === "live") {
    return "sold_out";
  }
  return "live";
}

function statusActionLabel(status: FarmOrderStatus): string {
  if (status === "live") {
    return "Go live";
  }
  if (status === "sold_out") {
    return "Mark sold out";
  }
  return "Set draft";
}

function statusTone(
  tone: string,
): { background: string; color: string } {
  if (tone === "resolved" || tone === "sold_out" || tone === "harvested") {
    return {
      background: "rgba(121, 160, 106, 0.16)",
      color: "#35533d",
    };
  }
  if (tone === "active" || tone === "live" || tone === "monitoring") {
    return {
      background: "rgba(178, 128, 55, 0.14)",
      color: "#6f4b1d",
    };
  }
  if (tone === "planned" || tone === "draft" || tone === "inactive" || tone === "open") {
    return {
      background: "rgba(92, 122, 153, 0.14)",
      color: "#34546d",
    };
  }
  return {
    background: "rgba(31, 41, 55, 0.08)",
    color: "var(--ink)",
  };
}

function issueSeverityTone(
  severity: FarmWorkItemSeverity,
): { background: string; color: string } {
  if (severity === "high") {
    return {
      background: "rgba(186, 92, 78, 0.16)",
      color: "#8b3e32",
    };
  }
  if (severity === "medium") {
    return {
      background: "rgba(178, 128, 55, 0.14)",
      color: "#6f4b1d",
    };
  }
  return {
    background: "rgba(121, 160, 106, 0.16)",
    color: "#35533d",
  };
}

function isAbsoluteHttpUrl(value: string | null | undefined): value is string {
  if (!value?.trim()) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const FarmPreview = styled.section<{ $highlighted: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.72rem;
  width: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 0.12rem;
  border-radius: 1.1rem;
  border: 1px solid
    ${({ $highlighted }) =>
      $highlighted
        ? "rgba(101, 144, 115, 0.36)"
        : "rgba(31, 41, 55, 0.08)"};
  box-shadow: ${({ $highlighted }) =>
    $highlighted ? "0 0 0 4px rgba(117, 158, 126, 0.12)" : "none"};
  transition: box-shadow 160ms ease, border-color 160ms ease;

  > * {
    flex: 0 0 auto;
    min-width: 0;
  }
`;

const FarmHero = styled.section`
  display: grid;
  gap: 0.42rem;
  flex-shrink: 0;
  padding: 0.68rem 0.76rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(117, 158, 126, 0.13), rgba(255, 255, 255, 0.88));
  border: 1px solid rgba(101, 144, 115, 0.12);
`;

const FarmHeroHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.7rem;
`;

const FarmHeroMain = styled.div`
  min-width: 0;
  flex: 1 1 320px;
  display: grid;
  gap: 0.45rem;
`;

const FarmEyebrow = styled.div`
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--accent-deep) 74%, var(--ink) 26%);
`;

const FarmTitleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.55rem;
  margin-top: 0.04rem;
`;

const FarmTitleActions = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.42rem;
  align-self: flex-start;
`;

const FarmTitle = styled.h4`
  margin: 0;
  font-size: 1rem;
  line-height: 1.05;
`;

const FarmLocation = styled.span`
  font-size: 0.82rem;
  line-height: 1.3;
  color: var(--muted);
`;

const FarmDescription = styled.p`
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.55;
  color: color-mix(in srgb, var(--ink) 88%, var(--muted) 12%);
`;

const FarmEditorWrap = styled.div`
  margin-top: 0.22rem;
`;

const FarmMetrics = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.34rem;
`;

const FarmMetric = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.34rem;
  min-height: 1.65rem;
  padding: 0.22rem 0.52rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(31, 41, 55, 0.08);

  strong {
    font-size: 0.82rem;
    line-height: 1;
  }

  span {
    font-size: 0.72rem;
    color: var(--muted);
  }
`;

const FarmSection = styled.section`
  display: grid;
  gap: 0.55rem;
  flex-shrink: 0;
  padding: 0.75rem 0.82rem;
  min-height: 0;
  border-radius: 0.95rem;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.78);
`;

const FarmSectionTitle = styled.h5`
  margin: 0;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
`;

const AreaList = styled.div`
  display: grid;
  gap: 0.65rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const AreaCard = styled.article`
  display: grid;
  gap: 0.45rem;
  padding: 0.9rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.82);
`;

const AreaHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
`;

const CropList = styled.div`
  display: grid;
  gap: 0.72rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const CropCard = styled.article<{ $highlighted: boolean }>`
  display: grid;
  gap: 0.72rem;
  padding: 0.95rem;
  border-radius: 1rem;
  border: 1px solid
    ${({ $highlighted }) =>
      $highlighted ? "rgba(101, 144, 115, 0.32)" : "rgba(31, 41, 55, 0.08)"};
  background:
    linear-gradient(145deg, rgba(246, 250, 244, 0.9), rgba(255, 255, 255, 0.94)),
    rgba(255, 255, 255, 0.88);
  box-shadow: ${({ $highlighted }) =>
    $highlighted ? "0 0 0 3px rgba(117, 158, 126, 0.12)" : "none"};
`;

const CropName = styled.div`
  font-weight: 700;
  font-size: 0.95rem;
  line-height: 1.18;
  color: var(--ink);
`;

const CropMetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  margin-top: 0.34rem;
`;

const CropDetailGrid = styled.div`
  display: grid;
  gap: 0.55rem;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
`;

const CropDetailItem = styled.div`
  display: grid;
  gap: 0.2rem;
`;

const CropDetailLabel = styled.div`
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
`;

const CropDetailValue = styled.div`
  font-size: 0.84rem;
  line-height: 1.45;
  color: var(--ink);
  word-break: break-word;
`;

const CropIssueSummaryRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;

  strong {
    font-size: 0.78rem;
  }
`;

const CropIssueDeadline = styled.div`
  font-size: 0.74rem;
  color: color-mix(in srgb, var(--ink) 86%, var(--muted) 14%);
`;

const CropIssuePreviewList = styled.div`
  font-size: 0.78rem;
  line-height: 1.45;
  white-space: pre-wrap;
`;

const CropWorkItemSummary = styled.div`
  display: grid;
  gap: 0.45rem;
  align-content: start;
  padding: 0.72rem 0.78rem;
  border-radius: 0.86rem;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.76);
`;

const CropNotesText = styled.div`
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--muted);
`;

const CropDeleteButton = styled.button`
  width: 1.85rem;
  height: 1.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(186, 92, 78, 0.2);
  background: rgba(255, 244, 242, 0.92);
  color: #8b3e32;
  border-radius: 999px;
  font: inherit;
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.58;
  }
`;

const WorkItemList = styled.div`
  display: grid;
  gap: 0.8rem;
`;

const WorkItemCard = styled.article`
  display: grid;
  gap: 0.55rem;
  padding: 0.95rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.82);
`;

const FarmCardHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
`;

const FarmCardTitle = styled.div`
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.16;
  color: var(--ink);
  word-break: break-word;
`;

const WorkItemMetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  margin-top: 0.32rem;
`;

const WorkItemTimeline = styled.div`
  font-size: 0.78rem;
  color: var(--muted);
`;

const WorkItemMarkdown = styled.div`
  font-size: 0.84rem;
  line-height: 1.55;
  color: color-mix(in srgb, var(--ink) 92%, var(--muted) 8%);

  p,
  ul,
  ol {
    margin: 0 0 0.7rem;
  }

  p:last-child,
  ul:last-child,
  ol:last-child {
    margin-bottom: 0;
  }

  ul,
  ol {
    padding-left: 1.2rem;
  }
`;

const WorkItemRelations = styled.div`
  display: grid;
  gap: 0.22rem;
`;

const RelationText = styled.div`
  font-size: 0.78rem;
  color: var(--muted);
`;

const SubtlePill = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  background: rgba(31, 41, 55, 0.06);
  color: var(--ink);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: capitalize;
`;

const FarmStatusPill = styled.span<{ $tone: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  background: ${({ $tone }) => statusTone($tone).background};
  color: ${({ $tone }) => statusTone($tone).color};
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: capitalize;
`;

const IssueSeverityPill = styled.span<{ $severity: FarmWorkItemSeverity }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  background: ${({ $severity }) => issueSeverityTone($severity).background};
  color: ${({ $severity }) => issueSeverityTone($severity).color};
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: capitalize;
`;

const IssueFollowUp = styled.div`
  font-size: 0.84rem;
  line-height: 1.5;
  color: color-mix(in srgb, var(--ink) 92%, var(--muted) 8%);
`;

const FarmActionButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.8);
  color: var(--ink);
  border-radius: 999px;
  padding: 0.32rem 0.62rem;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.58;
  }
`;

const FarmSecondaryButton = styled(FarmActionButton)`
  background: rgba(255, 255, 255, 0.66);
`;

const FarmDangerButton = styled(FarmActionButton)`
  border-color: rgba(186, 92, 78, 0.24);
  background: rgba(255, 244, 242, 0.92);
  color: #8b3e32;
`;

const OrderList = styled.div`
  display: grid;
  gap: 0.7rem;
`;

const OrderCard = styled.article<{ $highlighted: boolean }>`
  display: grid;
  gap: 0.7rem;
  padding: 0.95rem;
  border-radius: 1rem;
  border: 1px solid
    ${({ $highlighted }) =>
      $highlighted ? "rgba(101, 144, 115, 0.32)" : "rgba(31, 41, 55, 0.08)"};
  background:
    linear-gradient(145deg, rgba(249, 236, 207, 0.58), rgba(255, 255, 255, 0.92)),
    rgba(255, 255, 255, 0.88);
  box-shadow: ${({ $highlighted }) =>
    $highlighted ? "0 0 0 3px rgba(117, 158, 126, 0.12)" : "none"};
`;

const OrderMetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
`;

const OrderPrice = styled.span`
  font-size: 0.82rem;
  font-weight: 700;
  color: color-mix(in srgb, #7a3f08 72%, var(--ink) 28%);
`;

const OrderActionStack = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.42rem;
`;

const OrderSummary = styled.p`
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.5;
  color: color-mix(in srgb, var(--ink) 90%, var(--muted) 10%);
`;

const OrderItemList = styled.div`
  display: grid;
  gap: 0.42rem;
`;

const OrderItemRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.48rem 0.56rem;
  border-radius: 0.8rem;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(31, 41, 55, 0.08);

  strong {
    font-size: 0.84rem;
  }

  span {
    font-size: 0.78rem;
    color: var(--muted);
  }
`;

const OrderLinkRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
`;

const OrderLink = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  min-height: 2rem;
  padding: 0.38rem 0.72rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.86);
  color: var(--ink);
  text-decoration: none;
  font-size: 0.76rem;
  font-weight: 700;
`;
