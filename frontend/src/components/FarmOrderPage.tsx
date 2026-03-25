import { useEffect, useState } from "react";
import styled from "styled-components";

import { ApiError, fetchPublicFarmOrder } from "../lib/api";
import { parseFarmOrderPath, usePathname } from "../lib/router";
import type { PublicFarmOrderResponse } from "../types/farm";

export function FarmOrderPage() {
  const pathname = usePathname();
  const route = parseFarmOrderPath(pathname);
  const [orderData, setOrderData] = useState<PublicFarmOrderResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!route) {
      setOrderData(null);
      setError("This order link is incomplete.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetchPublicFarmOrder(route.farmId, route.orderId);
        if (!cancelled) {
          setOrderData(response);
          setError(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setOrderData(null);
          setError(
            requestError instanceof ApiError || requestError instanceof Error
              ? requestError.message
              : "We could not load this farm order.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [route?.farmId, route?.orderId]);

  const order = orderData?.order ?? null;

  return (
    <PageShell>
      <BackdropOrb $left="8%" $top="10%" $size="18rem" />
      <BackdropOrb $left="72%" $top="12%" $size="16rem" />
      <BackdropOrb $left="56%" $top="72%" $size="22rem" />
      <PageCard>
        <HeroSection>
          <HeroCopy>
            <HeroEyebrow>Farm order</HeroEyebrow>
            {loading ? (
              <>
                <HeroTitle>Loading order...</HeroTitle>
                <HeroText>Pulling the latest farm offer.</HeroText>
              </>
            ) : error || !order ? (
              <>
                <HeroTitle>Order unavailable</HeroTitle>
                <HeroText>{error ?? "This order could not be found."}</HeroText>
              </>
            ) : (
              <>
                <HeroTitle>{order.title}</HeroTitle>
                <HeroMeta>
                  <StatusBadge $status={order.status}>{formatStatus(order.status)}</StatusBadge>
                  {order.price_label ? <HeroPrice>{order.price_label}</HeroPrice> : null}
                </HeroMeta>
                <HeroText>
                  {[orderData?.farm_name, orderData?.location].filter(Boolean).join(" · ")}
                </HeroText>
                {order.summary ? <HeroSummary>{order.summary}</HeroSummary> : null}
                <HeroActions>
                  {order.status === "sold_out" ? (
                    <DisabledAction>Sold out</DisabledAction>
                  ) : isAbsoluteHttpUrl(order.order_url) ? (
                    <PrimaryAction href={order.order_url} rel="noreferrer" target="_blank">
                      Continue to order
                    </PrimaryAction>
                  ) : (
                    <DisabledAction>Order link coming soon</DisabledAction>
                  )}
                </HeroActions>
              </>
            )}
          </HeroCopy>
          <HeroVisual>
            {orderData?.hero_image_preview_url ? (
              <HeroImage
                alt={order?.hero_image_alt_text ?? order?.title ?? "Farm order"}
                src={orderData.hero_image_preview_url}
              />
            ) : (
              <IllustrationPanel>
                <IllustrationBadge>Seasonal mix</IllustrationBadge>
                <IllustrationText>
                  Built from the farm's saved catalog and ready to share.
                </IllustrationText>
              </IllustrationPanel>
            )}
          </HeroVisual>
        </HeroSection>

        {order && !loading && !error ? (
          <ContentGrid>
            <SectionCard>
              <SectionEyebrow>Included</SectionEyebrow>
              {order.items.length ? (
                <LineItemList>
                  {order.items.map((item) => (
                    <LineItem key={item.id}>
                      <div>
                        <strong>{item.label}</strong>
                        {item.notes ? <span>{item.notes}</span> : null}
                      </div>
                      {item.quantity ? <LineItemQty>{item.quantity}</LineItemQty> : null}
                    </LineItem>
                  ))}
                </LineItemList>
              ) : (
                <SectionText>No line items were saved for this order.</SectionText>
              )}
            </SectionCard>

            <SectionCard>
              <SectionEyebrow>Pickup notes</SectionEyebrow>
              <SectionText>
                {order.notes?.trim() ||
                  "Check the order link for pickup timing, substitutions, and availability details."}
              </SectionText>
            </SectionCard>
          </ContentGrid>
        ) : null}
      </PageCard>
    </PageShell>
  );
}

function formatStatus(status: PublicFarmOrderResponse["order"]["status"]): string {
  return status === "sold_out" ? "sold out" : status;
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

const PageShell = styled.main`
  --page-ink: #2c2418;
  --page-muted: #6f6353;
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  padding: 1.4rem;
  background:
    radial-gradient(circle at top left, rgba(255, 215, 138, 0.4), transparent 34%),
    linear-gradient(145deg, #f6f0df 0%, #f7d8c6 46%, #f1ede8 100%);
  color: var(--page-ink);
`;

const BackdropOrb = styled.div<{ $left: string; $top: string; $size: string }>`
  position: absolute;
  left: ${({ $left }) => $left};
  top: ${({ $top }) => $top};
  width: ${({ $size }) => $size};
  height: ${({ $size }) => $size};
  border-radius: 999px;
  background: radial-gradient(circle, rgba(207, 101, 55, 0.18), rgba(255, 255, 255, 0));
  filter: blur(18px);
  pointer-events: none;
`;

const PageCard = styled.section`
  position: relative;
  z-index: 1;
  width: min(1100px, 100%);
  margin: 0 auto;
  border-radius: 1.7rem;
  background: rgba(255, 252, 247, 0.78);
  border: 1px solid rgba(84, 64, 34, 0.1);
  box-shadow: 0 28px 80px rgba(74, 49, 22, 0.12);
  backdrop-filter: blur(14px);
  overflow: hidden;
`;

const HeroSection = styled.section`
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
  gap: 1rem;
  padding: 1.2rem;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

const HeroCopy = styled.div`
  display: grid;
  align-content: start;
  gap: 0.8rem;
  padding: 1.1rem;
`;

const HeroEyebrow = styled.div`
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9c5323;
`;

const HeroTitle = styled.h1`
  margin: 0;
  font-size: clamp(2.1rem, 4vw, 4.3rem);
  line-height: 0.95;
  letter-spacing: -0.04em;
`;

const HeroMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.7rem;
`;

const StatusBadge = styled.span<{ $status: PublicFarmOrderResponse["order"]["status"] }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.28rem 0.64rem;
  border-radius: 999px;
  background: ${({ $status }) =>
    $status === "sold_out" ? "rgba(120, 88, 61, 0.12)" : "rgba(201, 95, 41, 0.12)"};
  color: ${({ $status }) => ($status === "sold_out" ? "#6e5540" : "#8d4319")};
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: capitalize;
`;

const HeroPrice = styled.span`
  font-size: 1rem;
  font-weight: 800;
  color: #7d3e17;
`;

const HeroText = styled.p`
  margin: 0;
  font-size: 0.96rem;
  line-height: 1.5;
  color: var(--page-muted);
`;

const HeroSummary = styled.p`
  margin: 0;
  max-width: 32rem;
  font-size: 1.02rem;
  line-height: 1.7;
`;

const HeroActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-top: 0.3rem;
`;

const PrimaryAction = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 3rem;
  padding: 0.72rem 1.2rem;
  border-radius: 999px;
  background: linear-gradient(135deg, #c85e28, #a9441b);
  color: #fffaf3;
  text-decoration: none;
  font-weight: 800;
  letter-spacing: 0.01em;
  box-shadow: 0 14px 30px rgba(168, 68, 27, 0.22);
`;

const DisabledAction = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 3rem;
  padding: 0.72rem 1.2rem;
  border-radius: 999px;
  background: rgba(120, 88, 61, 0.08);
  color: #6e5c4a;
  font-weight: 800;
`;

const HeroVisual = styled.div`
  min-height: 22rem;
  border-radius: 1.4rem;
  overflow: hidden;
  background: linear-gradient(145deg, rgba(255, 232, 197, 0.78), rgba(255, 255, 255, 0.92));
  border: 1px solid rgba(84, 64, 34, 0.08);
`;

const HeroImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const IllustrationPanel = styled.div`
  display: grid;
  align-content: end;
  gap: 0.8rem;
  height: 100%;
  padding: 1.2rem;
  background:
    linear-gradient(180deg, rgba(255, 248, 233, 0.2), rgba(255, 255, 255, 0.92)),
    radial-gradient(circle at top right, rgba(217, 76, 40, 0.2), transparent 30%),
    radial-gradient(circle at bottom left, rgba(242, 204, 94, 0.28), transparent 34%);
`;

const IllustrationBadge = styled.div`
  width: fit-content;
  padding: 0.34rem 0.7rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.74);
  color: #8d4319;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const IllustrationText = styled.p`
  margin: 0;
  max-width: 16rem;
  font-size: 1.05rem;
  line-height: 1.5;
`;

const ContentGrid = styled.section`
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 1rem;
  padding: 0 1.2rem 1.2rem;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

const SectionCard = styled.section`
  display: grid;
  gap: 0.8rem;
  padding: 1rem;
  border-radius: 1.2rem;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(84, 64, 34, 0.08);
`;

const SectionEyebrow = styled.div`
  font-size: 0.74rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #9c5323;
`;

const LineItemList = styled.div`
  display: grid;
  gap: 0.62rem;
`;

const LineItem = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.82rem 0.88rem;
  border-radius: 0.95rem;
  background: rgba(247, 240, 223, 0.78);

  strong {
    display: block;
    margin-bottom: 0.18rem;
    font-size: 0.92rem;
  }

  span {
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--page-muted);
  }
`;

const LineItemQty = styled.div`
  min-width: 4.5rem;
  text-align: right;
  font-size: 0.9rem;
  font-weight: 800;
  color: #7d3e17;
`;

const SectionText = styled.p`
  margin: 0;
  font-size: 0.96rem;
  line-height: 1.7;
  color: var(--page-muted);
`;
