import { useEffect, useRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import {
  getAdvisoryCaseDisplayTitle,
  getNamesForIds,
  humanizeToken,
  normalizeAdvisoryPayload,
} from "../lib/advisory";
import type { AdvisoryRecordPayload, AdvisorySeverity } from "../types/advisory";

export type FarmRecordFocusTarget =
  | { kind: "record" }
  | { kind: "report"; itemId: string }
  | { kind: "query"; itemId: string };

export function FarmRecordPanel({
  farm,
  focusTarget = null,
  highlightRecord = false,
  dataTestId = "advisory-preview",
  farmEditor = null,
  onDeleteFarm,
  onEditFarm,
  showAreasSection = true,
  showCropsSection = true,
  showWorkItemsSection = true,
  showOrdersSection = true,
  showDescriptionSection = true,
  showSummarySection = true,
  isMutating = false,
}: {
  farm: AdvisoryRecordPayload;
  focusTarget?: FarmRecordFocusTarget | null;
  highlightRecord?: boolean;
  dataTestId?: string;
  farmEditor?: ReactNode;
  onDeleteCrop?: (cropId: string) => void;
  onDeleteFarm?: () => void;
  onDeleteOrder?: (orderId: string) => void;
  onEditFarm?: () => void;
  onEditOrder?: (orderId: string) => void;
  onSetOrderStatus?: (orderId: string, status: string) => void;
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
  const record = normalizeAdvisoryPayload(farm);
  const recordRef = useRef<HTMLElement | null>(null);
  const reportRefs = useRef<Record<string, HTMLElement | null>>({});
  const queryRefs = useRef<Record<string, HTMLElement | null>>({});
  const recordHighlighted = highlightRecord || focusTarget?.kind === "record";
  const subjectNamesById = new Map(record.subjects.map((subject) => [subject.id, subject.name] as const));

  useEffect(() => {
    if (!focusTarget) {
      return;
    }
    let target = recordRef.current;
    if (focusTarget.kind === "report") {
      target = reportRefs.current[focusTarget.itemId] ?? recordRef.current;
    } else if (focusTarget.kind === "query") {
      target = queryRefs.current[focusTarget.itemId] ?? recordRef.current;
    }
    target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusTarget]);

  return (
    <RecordPreview
      ref={recordRef}
      $highlighted={recordHighlighted}
      data-highlighted={recordHighlighted ? "true" : undefined}
      data-testid={dataTestId}
    >
      {showSummarySection ? (
        <RecordHero>
          <RecordHeroHeader>
            <RecordHeroMain>
              <RecordEyebrow>Advisory record</RecordEyebrow>
              {farmEditor ? (
                <RecordEditorWrap>{farmEditor}</RecordEditorWrap>
              ) : (
                <>
                  <RecordTitleRow>
                    <RecordTitle>{getAdvisoryCaseDisplayTitle(record.title)}</RecordTitle>
                    {record.default_location ? <RecordLocation>{record.default_location}</RecordLocation> : null}
                  </RecordTitleRow>
                  {record.profile_description ? (
                    <RecordDescription>{record.profile_description}</RecordDescription>
                  ) : null}
                  <RecordMetrics>
                    <RecordMetric>
                      <strong>{record.subjects.length}</strong>
                      <span>Subjects</span>
                    </RecordMetric>
                    <RecordMetric>
                      <strong>{record.reports.length}</strong>
                      <span>Reports</span>
                    </RecordMetric>
                    <RecordMetric>
                      <strong>{record.queries.length}</strong>
                      <span>Queries</span>
                    </RecordMetric>
                    <RecordMetric>
                      <strong>{record.measurements.length}</strong>
                      <span>Measurements</span>
                    </RecordMetric>
                    <RecordMetric>
                      <strong>{record.materials.length}</strong>
                      <span>Materials</span>
                    </RecordMetric>
                  </RecordMetrics>
                </>
              )}
            </RecordHeroMain>
            {!farmEditor ? (
              <RecordTitleActions>
                {onEditFarm ? (
                  <RecordActionButton disabled={isMutating} onClick={onEditFarm} type="button">
                    Edit
                  </RecordActionButton>
                ) : null}
                {onDeleteFarm ? (
                  <RecordDangerButton disabled={isMutating} onClick={onDeleteFarm} type="button">
                    Delete
                  </RecordDangerButton>
                ) : null}
              </RecordTitleActions>
            ) : null}
          </RecordHeroHeader>
        </RecordHero>
      ) : null}

      {showAreasSection ? (
        <RecordSection>
          <RecordSectionTitle>Subjects</RecordSectionTitle>
          {record.subjects.length ? (
            <CardGrid>
              {record.subjects.map((subject) => (
                <RecordCard key={subject.id} data-testid={`advisory-subject-${subject.id}`}>
                  <RecordCardHeader>
                    <div>
                      <RecordCardTitle>{subject.name}</RecordCardTitle>
                      <MetaRow>
                        <SubtlePill>{humanizeToken(subject.kind) ?? subject.kind}</SubtlePill>
                        {subject.status ? <StatusPill $tone={subject.status}>{humanizeToken(subject.status)}</StatusPill> : null}
                      </MetaRow>
                    </div>
                  </RecordCardHeader>
                  <DetailGrid>
                    <DetailItem>
                      <DetailLabel>Type</DetailLabel>
                      <DetailValue>{subject.type || "-"}</DetailValue>
                    </DetailItem>
                    <DetailItem>
                      <DetailLabel>Quantity</DetailLabel>
                      <DetailValue>{subject.quantity || "-"}</DetailValue>
                    </DetailItem>
                    <DetailItem>
                      <DetailLabel>Location</DetailLabel>
                      <DetailValue>{subject.location || "-"}</DetailValue>
                    </DetailItem>
                  </DetailGrid>
                  {subject.description ? <MetaText>{subject.description}</MetaText> : null}
                  {subject.notes ? <MetaText>{subject.notes}</MetaText> : null}
                </RecordCard>
              ))}
            </CardGrid>
          ) : (
            <MetaText>No subjects saved yet.</MetaText>
          )}
        </RecordSection>
      ) : null}

      {showWorkItemsSection ? (
        <RecordSection>
          <RecordSectionTitle>Reports</RecordSectionTitle>
          {record.reports.length ? (
            <StackList>
              {record.reports.map((report) => {
                const subjectNames = getNamesForIds(report.subject_ids, subjectNamesById);
                return (
                  <RecordCard
                    key={report.id}
                    ref={(node) => {
                      reportRefs.current[report.id] = node;
                    }}
                    data-testid={`advisory-report-${report.id}`}
                  >
                    <RecordCardHeader>
                      <div>
                        <RecordCardTitle>{report.title}</RecordCardTitle>
                        <MetaRow>
                          <SubtlePill>{humanizeToken(report.category) ?? report.category}</SubtlePill>
                          {report.status ? <StatusPill $tone={report.status}>{humanizeToken(report.status)}</StatusPill> : null}
                          {report.severity ? <SeverityPill $severity={report.severity}>{report.severity}</SeverityPill> : null}
                        </MetaRow>
                      </div>
                    </RecordCardHeader>
                    {report.observed_at || report.reported_at ? (
                      <Timeline>
                        {report.observed_at ? `Observed: ${report.observed_at}` : null}
                        {report.observed_at && report.reported_at ? " | " : null}
                        {report.reported_at ? `Reported: ${report.reported_at}` : null}
                      </Timeline>
                    ) : null}
                    {report.description ? (
                      <MarkdownBlock>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.description}</ReactMarkdown>
                      </MarkdownBlock>
                    ) : null}
                    {report.recommended_follow_up ? (
                      <FollowUp>
                        <strong>Follow-up:</strong> {report.recommended_follow_up}
                      </FollowUp>
                    ) : null}
                    {subjectNames.length || report.evidence_image_ids.length || report.measurement_ids.length ? (
                      <RelationList>
                        {subjectNames.length ? <RelationText><strong>Subjects:</strong> {subjectNames.join(", ")}</RelationText> : null}
                        {report.measurement_ids.length ? <RelationText><strong>Measurements:</strong> {report.measurement_ids.length}</RelationText> : null}
                        {report.evidence_image_ids.length ? <RelationText><strong>Images:</strong> {report.evidence_image_ids.length}</RelationText> : null}
                      </RelationList>
                    ) : null}
                  </RecordCard>
                );
              })}
            </StackList>
          ) : (
            <MetaText>No reports saved yet.</MetaText>
          )}
        </RecordSection>
      ) : null}

      {showCropsSection ? (
        <RecordSection>
          <RecordSectionTitle>Queries</RecordSectionTitle>
          {record.queries.length ? (
            <StackList>
              {record.queries.map((query) => (
                <RecordCard
                  key={query.id}
                  ref={(node) => {
                    queryRefs.current[query.id] = node;
                  }}
                  data-testid={`advisory-query-${query.id}`}
                >
                  <RecordCardHeader>
                    <div>
                      <RecordCardTitle>{query.question}</RecordCardTitle>
                      <MetaRow>
                        <SubtlePill>{humanizeToken(query.category) ?? query.category}</SubtlePill>
                        <StatusPill $tone={query.status}>{humanizeToken(query.status)}</StatusPill>
                      </MetaRow>
                    </div>
                  </RecordCardHeader>
                  {query.asked_at ? <Timeline>Asked: {query.asked_at}</Timeline> : null}
                  {query.answer_summary ? <MetaText>{query.answer_summary}</MetaText> : null}
                  {query.source_urls.length ? (
                    <RelationList>
                      <RelationText><strong>Sources:</strong> {query.source_urls.slice(0, 3).join(", ")}</RelationText>
                    </RelationList>
                  ) : null}
                </RecordCard>
              ))}
            </StackList>
          ) : (
            <MetaText>No queries saved yet.</MetaText>
          )}
        </RecordSection>
      ) : null}

      {showOrdersSection ? (
        <RecordSection>
          <RecordSectionTitle>Measurements & Materials</RecordSectionTitle>
          <CardGrid>
            <RecordCard>
              <RecordCardTitle>Measurements</RecordCardTitle>
              {record.measurements.length ? (
                <CompactList>
                  {record.measurements.map((measurement) => (
                    <li key={measurement.id}>
                      <strong>{measurement.label}</strong>
                      <span>{[measurement.value, measurement.unit].filter(Boolean).join(" ")}</span>
                    </li>
                  ))}
                </CompactList>
              ) : (
                <MetaText>No measurements saved yet.</MetaText>
              )}
            </RecordCard>
            <RecordCard>
              <RecordCardTitle>Materials</RecordCardTitle>
              {record.materials.length ? (
                <CompactList>
                  {record.materials.map((material) => (
                    <li key={material.id}>
                      <strong>{material.name}</strong>
                      <span>{[humanizeToken(material.status), material.supplier_name].filter(Boolean).join(" | ")}</span>
                    </li>
                  ))}
                </CompactList>
              ) : (
                <MetaText>No materials saved yet.</MetaText>
              )}
            </RecordCard>
          </CardGrid>
        </RecordSection>
      ) : null}

      {showDescriptionSection ? (
        <RecordSection>
          <RecordSectionTitle>Profile</RecordSectionTitle>
          {record.profile_description?.trim() ? (
            <MetaText>{record.profile_description}</MetaText>
          ) : (
            <MetaText>No advisory profile summary yet.</MetaText>
          )}
        </RecordSection>
      ) : null}
    </RecordPreview>
  );
}

function statusTone(tone: string): { background: string; color: string } {
  if (tone === "resolved" || tone === "answered" || tone === "available") {
    return { background: "rgba(121, 160, 106, 0.16)", color: "#35533d" };
  }
  if (tone === "active" || tone === "monitoring" || tone === "needs_follow_up" || tone === "ordered") {
    return { background: "rgba(178, 128, 55, 0.14)", color: "#6f4b1d" };
  }
  if (tone === "planned" || tone === "open" || tone === "to_check") {
    return { background: "rgba(92, 122, 153, 0.14)", color: "#34546d" };
  }
  return { background: "rgba(31, 41, 55, 0.08)", color: "var(--ink)" };
}

function severityTone(severity: AdvisorySeverity): { background: string; color: string } {
  if (severity === "high") {
    return { background: "rgba(186, 92, 78, 0.16)", color: "#8b3e32" };
  }
  if (severity === "medium") {
    return { background: "rgba(178, 128, 55, 0.14)", color: "#6f4b1d" };
  }
  return { background: "rgba(121, 160, 106, 0.16)", color: "#35533d" };
}

const RecordPreview = styled.section<{ $highlighted: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.72rem;
  width: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 0.12rem;
  border-radius: 1.1rem;
  border: 1px solid ${({ $highlighted }) => ($highlighted ? "rgba(101, 144, 115, 0.36)" : "rgba(31, 41, 55, 0.08)")};
  box-shadow: ${({ $highlighted }) => ($highlighted ? "0 0 0 4px rgba(117, 158, 126, 0.12)" : "none")};
`;

const RecordHero = styled.section`
  display: grid;
  gap: 0.42rem;
  padding: 0.68rem 0.76rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(117, 158, 126, 0.13), rgba(255, 255, 255, 0.88));
  border: 1px solid rgba(101, 144, 115, 0.12);
`;

const RecordHeroHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.7rem;
`;

const RecordHeroMain = styled.div`
  min-width: 0;
  flex: 1 1 320px;
  display: grid;
  gap: 0.45rem;
`;

const RecordEyebrow = styled.div`
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--accent-deep) 74%, var(--ink) 26%);
`;

const RecordTitleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.55rem;
`;

const RecordTitle = styled.h4`
  margin: 0;
  font-size: 1rem;
  line-height: 1.05;
`;

const RecordLocation = styled.span`
  font-size: 0.82rem;
  line-height: 1.3;
  color: var(--muted);
`;

const RecordDescription = styled.p`
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.55;
`;

const RecordEditorWrap = styled.div`
  margin-top: 0.22rem;
`;

const RecordTitleActions = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.42rem;
`;

const RecordMetrics = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.34rem;
`;

const RecordMetric = styled.div`
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

const RecordSection = styled.section`
  display: grid;
  gap: 0.55rem;
  padding: 0.75rem 0.82rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.78);
`;

const RecordSectionTitle = styled.h5`
  margin: 0;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
`;

const CardGrid = styled.div`
  display: grid;
  gap: 0.72rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
`;

const StackList = styled.div`
  display: grid;
  gap: 0.8rem;
`;

const RecordCard = styled.article`
  display: grid;
  gap: 0.55rem;
  padding: 0.95rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.82);
`;

const RecordCardHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
`;

const RecordCardTitle = styled.div`
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.16;
  color: var(--ink);
  word-break: break-word;
`;

const MetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  margin-top: 0.34rem;
`;

const DetailGrid = styled.div`
  display: grid;
  gap: 0.55rem;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
`;

const DetailItem = styled.div`
  display: grid;
  gap: 0.2rem;
`;

const DetailLabel = styled.div`
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
`;

const DetailValue = styled.div`
  font-size: 0.84rem;
  line-height: 1.45;
  word-break: break-word;
`;

const SubtlePill = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  background: rgba(31, 41, 55, 0.07);
  color: color-mix(in srgb, var(--ink) 82%, var(--muted) 18%);
`;

const StatusPill = styled(SubtlePill)<{ $tone: string }>`
  background: ${({ $tone }) => statusTone($tone).background};
  color: ${({ $tone }) => statusTone($tone).color};
`;

const SeverityPill = styled(SubtlePill)<{ $severity: AdvisorySeverity }>`
  background: ${({ $severity }) => severityTone($severity).background};
  color: ${({ $severity }) => severityTone($severity).color};
`;

const Timeline = styled.div`
  font-size: 0.74rem;
  color: color-mix(in srgb, var(--ink) 82%, var(--muted) 18%);
`;

const MarkdownBlock = styled.div`
  font-size: 0.82rem;
  line-height: 1.52;

  p {
    margin: 0 0 0.45rem;
  }

  p:last-child {
    margin-bottom: 0;
  }
`;

const FollowUp = styled.div`
  font-size: 0.8rem;
  line-height: 1.45;
  padding: 0.62rem 0.68rem;
  border-radius: 0.78rem;
  background: rgba(117, 158, 126, 0.1);
`;

const RelationList = styled.div`
  display: grid;
  gap: 0.25rem;
`;

const RelationText = styled.div`
  font-size: 0.76rem;
  line-height: 1.4;
  color: var(--muted);
  word-break: break-word;
`;

const CompactList = styled.ul`
  display: grid;
  gap: 0.42rem;
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.82rem;

  li {
    display: grid;
    gap: 0.12rem;
  }

  span {
    color: var(--muted);
  }
`;

const RecordActionButton = styled.button`
  border: 1px solid rgba(101, 144, 115, 0.24);
  background: rgba(246, 250, 244, 0.92);
  color: var(--accent-deep);
  border-radius: 999px;
  padding: 0.38rem 0.7rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 800;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.58;
  }
`;

const RecordDangerButton = styled(RecordActionButton)`
  border-color: rgba(186, 92, 78, 0.2);
  background: rgba(255, 244, 242, 0.92);
  color: #8b3e32;
`;
