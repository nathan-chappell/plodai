import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import ReactMarkdown from "react-markdown";

import { MetaText } from "../app/styles";
import { resolveReportImageDataUrl } from "../lib/report-chart-preview";
import type { LocalWorkspaceFile } from "../types/report";
import type { WorkspaceReportV1 } from "../types/workspace-contract";

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function WorkspaceReportDrawer({
  currentReport,
  files = [],
  dataTestId,
}: {
  currentReport: WorkspaceReportV1 | null;
  files?: LocalWorkspaceFile[];
  dataTestId?: string;
}) {
  const slides = currentReport?.slides ?? [];
  const [collapsed, setCollapsed] = useState(slides.length === 0);
  const [activeSlideIndex, setActiveSlideIndex] = useState(
    Math.max(slides.length - 1, 0),
  );
  const previousSlideCountRef = useRef(slides.length);

  useEffect(() => {
    if (!slides.length) {
      setCollapsed(true);
      setActiveSlideIndex(0);
      return;
    }
    setActiveSlideIndex((current) => Math.min(current, slides.length - 1));
  }, [slides.length]);

  useEffect(() => {
    if (previousSlideCountRef.current === 0 && slides.length > 0) {
      setCollapsed(false);
    }
    previousSlideCountRef.current = slides.length;
  }, [slides.length]);

  const activeSlide = slides[activeSlideIndex] ?? null;
  const firstChartPanel =
    activeSlide?.panels.find((panel) => panel.type === "chart") ?? null;
  const firstImagePanel =
    activeSlide?.panels.find((panel) => panel.type === "image") ?? null;
  const firstNarrativePanel =
    activeSlide?.panels.find((panel) => panel.type === "narrative") ?? null;
  const updatedLabel = formatTimestamp(
    currentReport?.updated_at ?? currentReport?.created_at,
  );

  return (
    <DrawerPanel data-testid={dataTestId}>
      <DrawerHeader>
        <div>
          <DrawerEyebrow>Report</DrawerEyebrow>
          <DrawerTitle>{currentReport?.title ?? "Current report"}</DrawerTitle>
          <MetaText>
            {slides.length
              ? `${slides.length} saved slide${slides.length === 1 ? "" : "s"}`
              : "No saved slides yet"}
            {updatedLabel ? ` · Updated ${updatedLabel}` : ""}
          </MetaText>
        </div>
        <DrawerToggle
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
          type="button"
        >
          {collapsed ? "Open" : "Hide"}
        </DrawerToggle>
      </DrawerHeader>

      {collapsed ? null : (
        <DrawerBody>
          {activeSlide ? (
            <>
              <DrawerToolbar>
                <DrawerSlideTitle>
                  {activeSlide.title}
                </DrawerSlideTitle>
                <DrawerSlideControls>
                  <DrawerNavButton
                    disabled={activeSlideIndex === 0}
                    onClick={() =>
                      setActiveSlideIndex((current) => Math.max(current - 1, 0))
                    }
                    type="button"
                  >
                    Prev
                  </DrawerNavButton>
                  <DrawerSlideMeta>
                    {activeSlideIndex + 1} / {slides.length}
                  </DrawerSlideMeta>
                  <DrawerNavButton
                    disabled={activeSlideIndex >= slides.length - 1}
                    onClick={() =>
                      setActiveSlideIndex((current) =>
                        Math.min(current + 1, slides.length - 1),
                      )
                    }
                    type="button"
                  >
                    Next
                  </DrawerNavButton>
                </DrawerSlideControls>
              </DrawerToolbar>
              {firstImagePanel ? (
                resolveReportImageDataUrl(files, firstImagePanel) ? (
                  <DrawerChartImage
                    alt={firstImagePanel.alt_text ?? firstImagePanel.title}
                    src={resolveReportImageDataUrl(files, firstImagePanel) ?? ""}
                  />
                ) : (
                  <MetaText>This slide is saved, but its image preview is not available yet.</MetaText>
                )
              ) : firstChartPanel?.image_data_url ? (
                <DrawerChartImage
                  alt={firstChartPanel.title}
                  src={firstChartPanel.image_data_url}
                />
              ) : firstNarrativePanel ? (
                <DrawerMarkdown>
                  <ReactMarkdown>{firstNarrativePanel.markdown}</ReactMarkdown>
                </DrawerMarkdown>
              ) : (
                <MetaText>This slide is saved, but its preview is not available yet.</MetaText>
              )}
            </>
          ) : (
            <MetaText>
              The report drawer will expand automatically when the first slide is saved.
            </MetaText>
          )}
        </DrawerBody>
      )}
    </DrawerPanel>
  );
}

const DrawerPanel = styled.section`
  display: grid;
  gap: 0.72rem;
  padding: 0.92rem;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(31, 41, 55, 0.16);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(249, 244, 238, 0.9)),
    var(--panel);
`;

const DrawerHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
`;

const DrawerEyebrow = styled.div`
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const DrawerTitle = styled.h3`
  margin: 0.1rem 0 0.16rem;
  font-size: 0.96rem;
  line-height: 1.15;
`;

const DrawerToggle = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.7);
  color: var(--ink);
  border-radius: 999px;
  padding: 0.38rem 0.72rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
`;

const DrawerBody = styled.div`
  display: grid;
  gap: 0.62rem;
`;

const DrawerToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
`;

const DrawerSlideTitle = styled.strong`
  min-width: 0;
  font-size: 0.86rem;
  line-height: 1.2;
`;

const DrawerSlideControls = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
`;

const DrawerSlideMeta = styled(MetaText)`
  font-size: 0.72rem;
`;

const DrawerNavButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.76);
  color: var(--ink);
  border-radius: 999px;
  padding: 0.28rem 0.58rem;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const DrawerChartImage = styled.img`
  width: 100%;
  border-radius: 16px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.82);
`;

const DrawerMarkdown = styled.div`
  max-height: 220px;
  overflow: auto;
  border-radius: 16px;
  border: 1px solid rgba(31, 41, 55, 0.1);
  background: rgba(255, 255, 255, 0.72);
  padding: 0.8rem;
  color: var(--ink);
  font-size: 0.78rem;
  line-height: 1.55;

  p,
  ul,
  ol {
    margin: 0 0 0.5rem;
  }

  p:last-child,
  ul:last-child,
  ol:last-child {
    margin-bottom: 0;
  }
`;
