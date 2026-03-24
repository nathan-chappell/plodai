import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import {
  WorkspaceModalBackdrop,
  WorkspaceModalCard,
  WorkspaceModalCloseButton,
  WorkspaceModalHeader,
  WorkspaceModalMeta,
  WorkspaceModalTitle,
  WorkspaceModalTitleBlock,
} from "./styles";
import type {
  FarmItemPayloadV1,
  FarmOrderStatusV1,
} from "../types/workspace";

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
  showOrdersSection = true,
  isMutating = false,
}: {
  farm: FarmItemPayloadV1;
  focusTarget?: FarmRecordFocusTarget | null;
  highlightRecord?: boolean;
  dataTestId?: string;
  farmEditor?: ReactNode;
  onDeleteCrop?: (cropId: string) => void;
  onDeleteFarm?: () => void;
  onDeleteOrder?: (orderId: string) => void;
  onEditFarm?: () => void;
  onEditOrder?: (orderId: string) => void;
  onSetOrderStatus?: (orderId: string, status: FarmOrderStatusV1) => void;
  orderShareUrls?: Record<string, string>;
  showOrdersSection?: boolean;
  isMutating?: boolean;
}) {
  const recordRef = useRef<HTMLElement | null>(null);
  const cropRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const orderRefs = useRef<Record<string, HTMLElement | null>>({});
  const [activeCropNotes, setActiveCropNotes] = useState<{
    cropId: string;
    cropName: string;
    notes: string;
  } | null>(null);
  const orders = farm.orders ?? [];

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

  useEffect(() => {
    if (!activeCropNotes || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveCropNotes(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeCropNotes]);

  const recordHighlighted = highlightRecord || focusTarget?.kind === "record";

  return (
    <FarmPreview
      ref={recordRef}
      $highlighted={recordHighlighted}
      data-highlighted={recordHighlighted ? "true" : undefined}
      data-testid={dataTestId}
    >
      <FarmHero>
        <FarmHeroHeader>
          <FarmHeroMain>
            <FarmEyebrow>Farm</FarmEyebrow>
            {farmEditor ? (
              <FarmEditorWrap>{farmEditor}</FarmEditorWrap>
            ) : (
              <>
                <FarmTitleRow>
                  <FarmTitle>{farm.farm_name}</FarmTitle>
                  {farm.location ? <FarmLocation>{farm.location}</FarmLocation> : null}
                </FarmTitleRow>
                <FarmMetrics>
                  <FarmMetric>
                    <strong>{farm.crops.length}</strong>
                    <span>Crops</span>
                  </FarmMetric>
                  <FarmMetric>
                    <strong>{farm.notes?.trim() ? "Saved" : "Empty"}</strong>
                    <span>Notes</span>
                  </FarmMetric>
                  <FarmMetric>
                    <strong>{orders.length}</strong>
                    <span>Orders</span>
                  </FarmMetric>
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

      <FarmSection>
        <FarmSectionTitle>Crops</FarmSectionTitle>
        {farm.crops.length ? (
          <CropTableWrap>
            <CropTable>
              <thead>
                <tr>
                  <th>What</th>
                  <th>Where / amount</th>
                  <th>Yield</th>
                  <th>Notes</th>
                  <CropActionHeader aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {farm.crops.map((crop) => {
                  const highlighted =
                    focusTarget?.kind === "crop" && focusTarget.itemId === crop.id;
                  const cropNotes = crop.notes?.trim() || "";
                  return (
                    <CropTableRow
                      key={crop.id}
                      ref={(node) => {
                        cropRefs.current[crop.id] = node;
                      }}
                      $highlighted={highlighted}
                      data-highlighted={highlighted ? "true" : undefined}
                      data-testid={`farm-crop-${crop.id}`}
                    >
                      <td>
                        <CropName>{crop.name}</CropName>
                      </td>
                      <td>{crop.area}</td>
                      <td>{crop.expected_yield?.trim() || "-"}</td>
                      <td>
                        {cropNotes ? (
                          <CropNotesCell>
                            <CropNotesPreview data-testid={`farm-crop-notes-preview-${crop.id}`}>
                              {cropNotes}
                            </CropNotesPreview>
                            <CropNotesButton
                              data-testid={`farm-open-crop-notes-${crop.id}`}
                              onClick={() =>
                                setActiveCropNotes({
                                  cropId: crop.id,
                                  cropName: crop.name,
                                  notes: cropNotes,
                                })
                              }
                              type="button"
                            >
                              View
                            </CropNotesButton>
                          </CropNotesCell>
                        ) : (
                          "-"
                        )}
                      </td>
                      <CropActionCell>
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
                      </CropActionCell>
                    </CropTableRow>
                  );
                })}
              </tbody>
            </CropTable>
          </CropTableWrap>
        ) : (
          <MetaText>No crops tracked yet.</MetaText>
        )}
      </FarmSection>

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
                          <FarmStatusPill $tone={order.status}>{formatOrderStatus(order.status)}</FarmStatusPill>
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

      <FarmSection>
        <FarmSectionTitle>Notes</FarmSectionTitle>
        {farm.notes?.trim() ? (
          <MetaText>{farm.notes}</MetaText>
        ) : (
          <MetaText>
            No notes saved yet. The PlodAI agent will keep durable observations here.
          </MetaText>
        )}
      </FarmSection>

      {activeCropNotes ? (
        <WorkspaceModalBackdrop
          data-testid="farm-crop-notes-modal-backdrop"
          onClick={() => setActiveCropNotes(null)}
        >
          <CropNotesModalCard
            data-testid="farm-crop-notes-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <WorkspaceModalHeader>
              <WorkspaceModalTitleBlock>
                <WorkspaceModalTitle>{activeCropNotes.cropName}</WorkspaceModalTitle>
                <WorkspaceModalMeta>Full crop notes rendered as markdown.</WorkspaceModalMeta>
              </WorkspaceModalTitleBlock>
              <WorkspaceModalCloseButton
                onClick={() => setActiveCropNotes(null)}
                type="button"
              >
                Close
              </WorkspaceModalCloseButton>
            </WorkspaceModalHeader>
            <CropNotesMarkdown data-testid="farm-crop-notes-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {activeCropNotes.notes}
              </ReactMarkdown>
            </CropNotesMarkdown>
          </CropNotesModalCard>
        </WorkspaceModalBackdrop>
      ) : null}
    </FarmPreview>
  );
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
  gap: 0.9rem;
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: 0.2rem;
  border-radius: 1.1rem;
  border: 1px solid
    ${({ $highlighted }) =>
      $highlighted
        ? "rgba(101, 144, 115, 0.36)"
        : "rgba(31, 41, 55, 0.08)"};
  box-shadow: ${({ $highlighted }) =>
    $highlighted ? "0 0 0 4px rgba(117, 158, 126, 0.12)" : "none"};
  transition: box-shadow 160ms ease, border-color 160ms ease;
`;

const FarmHero = styled.section`
  display: grid;
  gap: 0.55rem;
  padding: 0.8rem 0.88rem;
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
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
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
  font-size: 1.08rem;
  line-height: 1.05;
`;

const FarmLocation = styled.span`
  font-size: 0.82rem;
  line-height: 1.3;
  color: var(--muted);
`;

const FarmEditorWrap = styled.div`
  margin-top: 0.22rem;
`;

const FarmMetrics = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.42rem;
`;

const FarmMetric = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.34rem;
  min-height: 1.9rem;
  padding: 0.3rem 0.6rem;
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
  padding: 0.9rem 0.95rem;
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

const CropTableWrap = styled.div`
  overflow-x: auto;
`;

const CropTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;

  th {
    padding: 0 0.7rem 0.55rem;
    text-align: left;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }

  td {
    padding: 0.72rem 0.7rem;
    vertical-align: top;
    font-size: 0.82rem;
    color: var(--ink);
    border-top: 1px solid rgba(31, 41, 55, 0.08);
  }
`;

const CropActionHeader = styled.th`
  width: 3rem;
  padding-right: 0.25rem;
`;

const CropTableRow = styled.tr<{ $highlighted: boolean }>`
  background: ${({ $highlighted }) =>
    $highlighted ? "rgba(220, 245, 224, 0.96)" : "transparent"};
  box-shadow: ${({ $highlighted }) =>
    $highlighted ? "inset 0 0 0 2px rgba(117, 158, 126, 0.22)" : "none"};
`;

const CropActionCell = styled.td`
  width: 3rem;
  text-align: right;
  padding-right: 0.3rem;
`;

const CropName = styled.div`
  font-weight: 700;
  color: var(--ink);
`;

const CropNotesCell = styled.div`
  display: grid;
  gap: 0.45rem;
  align-content: start;
`;

const CropNotesPreview = styled.div`
  max-height: 8.75rem;
  overflow: auto;
  padding-right: 0.25rem;
  white-space: pre-wrap;
  line-height: 1.5;
  color: color-mix(in srgb, var(--ink) 92%, var(--muted) 8%);
  scrollbar-gutter: stable;
`;

const CropNotesButton = styled.button`
  width: fit-content;
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.8);
  color: var(--ink);
  border-radius: 999px;
  padding: 0.32rem 0.62rem;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;
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

const FarmCardHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
`;

const FarmCardTitle = styled.div`
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.16;
  color: var(--ink);
  margin-bottom: 0.32rem;
`;

const FarmStatusPill = styled.span<{ $tone: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  background: ${({ $tone }) =>
    $tone === "resolved" || $tone === "done"
      ? "rgba(121, 160, 106, 0.16)"
      : $tone === "active"
        ? "rgba(178, 128, 55, 0.14)"
        : "rgba(92, 122, 153, 0.14)"};
  color: ${({ $tone }) =>
    $tone === "resolved" || $tone === "done"
      ? "#35533d"
      : $tone === "active"
        ? "#6f4b1d"
        : "#34546d"};
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: capitalize;
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

const CropNotesModalCard = styled(WorkspaceModalCard)`
  width: min(720px, 100%);
  display: grid;
  gap: 0.85rem;
`;

const CropNotesMarkdown = styled.div`
  min-height: 0;
  max-height: min(68vh, 620px);
  overflow: auto;
  padding-right: 0.2rem;
  font-size: 0.92rem;
  line-height: 1.65;
  color: var(--ink);

  p,
  ul,
  ol {
    margin: 0 0 0.75rem;
  }

  ul,
  ol {
    padding-left: 1.3rem;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.88em;
  }

  pre {
    overflow: auto;
    padding: 0.75rem;
    border-radius: 0.8rem;
    background: rgba(17, 24, 39, 0.06);
  }
`;
