import { useMemo, useState } from "react";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import { useAgentShell } from "../app/workspace";
import { navigate } from "../lib/router";
import {
  listAdminTestCases,
  loadAdminTestCaseFiles,
  type AdminTestCase,
} from "../lib/admin-test-cases";
import {
  AdminPanelCard,
  AdminPanelMessage,
  AdminPanelSecondaryButton,
  AdminPanelTitle,
} from "./styles";

function routeForApp(appId: AdminTestCase["app_id"]): string {
  return appId === "plodai" ? "/plodai" : "/documents";
}

export function AdminTestCasesPanel() {
  const { createWorkspace, handleSelectFiles, queuePendingComposerLaunch } = useAgentShell();
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const testCases = useMemo(() => listAdminTestCases(), []);

  async function handleRunTestCase(testCase: AdminTestCase) {
    setRunningCaseId(testCase.id);
    setStatus(null);

    try {
      const workspaceId = await createWorkspace({
        appId: testCase.app_id,
        name: testCase.title,
      });
      const files = await loadAdminTestCaseFiles(testCase);
      await handleSelectFiles(files, {
        workspaceId,
        appId: testCase.app_id,
      });
      queuePendingComposerLaunch({
        appId: testCase.app_id,
        workspaceId,
        prompt: testCase.prompt,
        model: testCase.model ?? null,
      });
      navigate(routeForApp(testCase.app_id));
      setStatus(`Loaded ${testCase.title}.`);
    } catch (error) {
      setStatus(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Unable to load the selected test case.",
      );
    } finally {
      setRunningCaseId(null);
    }
  }

  return (
    <AdminPanelCard>
      <AdminPanelTitle>Test cases</AdminPanelTitle>
      <MetaText>
        Repo-backed prompts and files for admins. Running one loads a normal app
        workspace and prefills the composer without auto-sending.
      </MetaText>

      <TestCaseList>
        {testCases.map((testCase) => (
          <TestCaseCard key={testCase.id}>
            <TestCaseHeader>
              <div>
                <strong>{testCase.title}</strong>
                <TestCaseAppPill>{testCase.app_id}</TestCaseAppPill>
              </div>
              <AdminPanelSecondaryButton
                disabled={runningCaseId !== null}
                onClick={() => void handleRunTestCase(testCase)}
                type="button"
              >
                {runningCaseId === testCase.id ? "Loading..." : "Run"}
              </AdminPanelSecondaryButton>
            </TestCaseHeader>
            <TestCaseSummary>{testCase.summary}</TestCaseSummary>
            <TestCaseMeta>
              {testCase.files.length} file{testCase.files.length === 1 ? "" : "s"} · model{" "}
              {testCase.model ?? "default"}
            </TestCaseMeta>
          </TestCaseCard>
        ))}
      </TestCaseList>

      {status ? <AdminPanelMessage>{status}</AdminPanelMessage> : null}
    </AdminPanelCard>
  );
}

const TestCaseList = styled.div`
  display: grid;
  gap: 0.8rem;
  margin-top: 1rem;
`;

const TestCaseCard = styled.div`
  display: grid;
  gap: 0.45rem;
  padding: 0.85rem 0.95rem;
  border-radius: 1rem;
  border: 1px solid rgba(31, 41, 55, 0.1);
  background: rgba(255, 255, 255, 0.78);
`;

const TestCaseHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
`;

const TestCaseAppPill = styled.span`
  display: inline-flex;
  align-items: center;
  margin-left: 0.55rem;
  padding: 0.18rem 0.52rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, white 88%);
  color: var(--accent-deep);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: capitalize;
`;

const TestCaseSummary = styled.p`
  margin: 0;
  color: var(--muted);
  line-height: 1.45;
`;

const TestCaseMeta = styled.span`
  color: var(--muted);
  font-size: 0.84rem;
`;
