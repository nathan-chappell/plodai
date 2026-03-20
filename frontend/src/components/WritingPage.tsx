import styled from "styled-components";

import { navigate } from "../lib/router";
import { SIGN_IN_PATH } from "../lib/auth";
import { formatWritingDate, listPublishedWritingEntries } from "../lib/writing";

const publishedEntries = listPublishedWritingEntries();

const WritingShell = styled.main`
  min-height: 100vh;
  min-height: 100dvh;
  padding: clamp(1.2rem, 3vw, 2rem);
`;

const WritingLayout = styled.div`
  width: min(1080px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 1rem;
`;

const WritingHero = styled.section`
  display: grid;
  gap: 0.7rem;
  padding: clamp(1.35rem, 3vw, 2rem);
  border: 1px solid var(--line);
  border-radius: 28px;
  background:
    linear-gradient(145deg, rgba(255, 252, 247, 0.95), rgba(239, 228, 214, 0.9)),
    radial-gradient(circle at top right, rgba(73, 127, 162, 0.14), transparent 34%);
  box-shadow: var(--shadow);
`;

const Eyebrow = styled.div`
  font-size: 0.74rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const Title = styled.h1`
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.3rem, 5vw, 4.4rem);
  line-height: 0.94;
`;

const Subhead = styled.p`
  margin: 0;
  max-width: 64ch;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.7;
`;

const ActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
`;

const ActionButton = styled.button<{ $primary?: boolean }>`
  border: 1px solid ${({ $primary }) => ($primary ? "transparent" : "var(--line)")};
  padding: 0.72rem 1rem;
  border-radius: 999px;
  background: ${({ $primary }) => ($primary ? "var(--ink)" : "rgba(255, 255, 255, 0.6)")};
  color: ${({ $primary }) => ($primary ? "white" : "var(--ink)")};
  cursor: pointer;
  transition: transform 180ms ease, background 180ms ease;

  &:hover {
    transform: translateY(-1px);
  }
`;

const WritingGrid = styled.section`
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 1rem;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
`;

const WritingCard = styled.article`
  grid-column: span 6;
  display: grid;
  gap: 0.85rem;
  padding: 1.25rem;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: rgba(255, 251, 246, 0.88);
  box-shadow: var(--shadow);

  @media (max-width: 920px) {
    grid-column: auto;
  }
`;

const WritingMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: center;
`;

const PlatformBadge = styled.span`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.56rem;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, rgba(31, 41, 55, 0.1));
  background: color-mix(in srgb, var(--accent) 10%, white 90%);
  color: var(--accent-deep);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const DateMeta = styled.span`
  color: var(--muted);
  font-size: 0.82rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const WritingTitle = styled.h2`
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.4rem, 3vw, 2rem);
  line-height: 1;
`;

const WritingSummary = styled.p`
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
`;

const WritingLink = styled.a`
  display: inline-flex;
  width: fit-content;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 0.6rem 0.88rem;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.72);
  color: var(--ink);
  font-weight: 700;
  text-decoration: none;
`;

export function WritingPage() {
  return (
    <WritingShell data-testid="writing-page">
      <WritingLayout>
        <WritingHero>
          <Eyebrow>Writing</Eyebrow>
          <Title>Posts, essays, and external publication links.</Title>
          <Subhead>
            This page now acts as the public writing index for the project. Published Mono posts appear here first, and
            LinkedIn pieces can join the same catalog as they go live.
          </Subhead>
          <ActionRow>
            <ActionButton $primary onClick={() => navigate(SIGN_IN_PATH)} type="button">
              Sign in
            </ActionButton>
          </ActionRow>
        </WritingHero>

        <WritingGrid>
          {publishedEntries.map((entry) => (
            <WritingCard key={entry.id}>
              <WritingMeta>
                <PlatformBadge>{entry.platform}</PlatformBadge>
                {formatWritingDate(entry.publishedAt) ? <DateMeta>{formatWritingDate(entry.publishedAt)}</DateMeta> : null}
              </WritingMeta>
              <WritingTitle>{entry.title}</WritingTitle>
              <WritingSummary>{entry.summary}</WritingSummary>
              <WritingLink href={entry.url} rel="noreferrer" target="_blank">
                Open article
              </WritingLink>
            </WritingCard>
          ))}
        </WritingGrid>
      </WritingLayout>
    </WritingShell>
  );
}
