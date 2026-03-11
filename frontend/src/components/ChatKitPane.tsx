import styled from "styled-components";

const Card = styled.section`
  background: linear-gradient(135deg, rgba(44, 62, 80, 0.94), rgba(26, 36, 47, 0.96));
  color: #f8f6f2;
  border-radius: var(--radius-xl);
  padding: 1.3rem;
  box-shadow: var(--shadow);
  display: grid;
  gap: 0.75rem;
`;

const Meta = styled.p`
  margin: 0;
  color: rgba(248, 246, 242, 0.74);
  line-height: 1.65;
`;

const Pill = styled.div`
  display: inline-flex;
  width: fit-content;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

export function ChatKitPane() {
  return (
    <Card>
      <Pill>ChatKit Scaffold</Pill>
      <h2>Conversation Surface</h2>
      <Meta>
        The OpenAI ChatKit dependency is queued for install and this pane is the handoff point for client tools,
        client effects, and report artifact streaming.
      </Meta>
      <Meta>
        We are intentionally pausing before wiring ChatKit persistence and conversation history storage.
      </Meta>
    </Card>
  );
}
