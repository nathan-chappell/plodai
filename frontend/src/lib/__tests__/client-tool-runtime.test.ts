import { afterEach, describe, expect, it, vi } from "vitest";

import { executeLocalTool } from "../client-tool-runtime";
import type { AgentRuntimeContext } from "../../agents/types";
import type {
  FarmItemPayloadV1,
  WorkspaceCreatedItemDetail,
  WorkspaceItemCreatePayload,
} from "../../types/workspace";

function createWorkspaceContext(options?: {
  artifacts?: AgentRuntimeContext["listArtifacts"];
  createArtifact?: AgentRuntimeContext["createArtifact"];
  getArtifact?: AgentRuntimeContext["getArtifact"];
  applyArtifactOperation?: AgentRuntimeContext["applyArtifactOperation"];
  updateWorkspace?: AgentRuntimeContext["updateWorkspace"];
}): AgentRuntimeContext {
  return {
    workspaceId: "workspace-1",
    workspaceName: "Farm",
    activeThreadId: null,
    agentId: "plodai-agent",
    agentTitle: "PlodAI",
    activeAgentId: "plodai-agent",
    selectedFileId: null,
    selectedArtifactId: null,
    currentReportArtifactId: null,
    listFiles: () => [],
    getFile: () => null,
    resolveLocalFile: async () => null,
    registerFile: async () => {
      throw new Error("registerFile not used in this test");
    },
    removeFile: async () => {
      throw new Error("removeFile not used in this test");
    },
    listArtifacts: options?.artifacts ?? (() => []),
    getArtifact:
      options?.getArtifact ??
      (async () => {
        throw new Error("getArtifact not used in this test");
      }),
    listArtifactRevisions: async () => [],
    createArtifact:
      options?.createArtifact ??
      (async () => {
        throw new Error("createArtifact not used in this test");
      }),
    applyArtifactOperation:
      options?.applyArtifactOperation ??
      (async () => {
        throw new Error("applyArtifactOperation not used in this test");
      }),
    updateWorkspace: options?.updateWorkspace ?? (async () => null),
  };
}

describe("client tool runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates farm artifacts with a unique persisted id", async () => {
    let createdPayload: WorkspaceItemCreatePayload | null = null;
    const uuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("persisted-farm-id");

    const workspace = createWorkspaceContext({
      createArtifact: async (payload) => {
        createdPayload = payload;
        return {
          origin: "created",
          id: payload.id,
          workspace_id: "workspace-1",
          kind: "farm.v1",
          schema_version: "v1",
          title: "North Orchard",
          current_revision: 1,
          created_by_user_id: "user-1",
          created_by_agent_id: "plodai-agent",
          last_edited_by_agent_id: "plodai-agent",
          summary: {
            crop_count: 1,
            order_count: 0,
          },
          latest_op: "item.create",
          created_at: "2026-03-24T00:00:00Z",
          updated_at: "2026-03-24T00:00:00Z",
          payload: payload.payload,
        } satisfies WorkspaceCreatedItemDetail;
      },
    });

    const result = await executeLocalTool(workspace, "save_farm_state", {
      farm_name: "North Orchard",
      location: "Block A",
      crops: [
        {
          id: "crop-1",
          name: "Walnut",
          area: "North field",
          expected_yield: null,
          notes: "Healthy canopy",
        },
      ],
      notes: "Saved from image assessment",
    });

    expect(uuidSpy).toHaveBeenCalledOnce();
    expect(createdPayload?.id).toBe("farm-persisted-farm-id");
    expect(createdPayload?.kind).toBe("farm.v1");
    expect((createdPayload?.payload as FarmItemPayloadV1).farm_name).toBe("North Orchard");
    expect(result.payload.artifact_id).toBe("farm-persisted-farm-id");
  });

  it("updates the existing farm artifact instead of creating a second one", async () => {
    let createCalls = 0;
    let appliedOperation: Parameters<AgentRuntimeContext["applyArtifactOperation"]>[1] | null = null;

    const workspace = createWorkspaceContext({
      artifacts: () => [
        {
          origin: "created",
          id: "farm-existing",
          workspace_id: "workspace-1",
          kind: "farm.v1",
          schema_version: "v1",
          title: "North Orchard",
          current_revision: 2,
          created_by_user_id: "user-1",
          created_by_agent_id: "plodai-agent",
          last_edited_by_agent_id: "plodai-agent",
          summary: {
            crop_count: 1,
            order_count: 0,
          },
          latest_op: "farm.set_state",
          created_at: "2026-03-24T00:00:00Z",
          updated_at: "2026-03-24T00:05:00Z",
        },
      ],
      createArtifact: async () => {
        createCalls += 1;
        throw new Error("createArtifact should not be called for an existing farm");
      },
      getArtifact: async () => ({
        origin: "created",
        id: "farm-existing",
        workspace_id: "workspace-1",
        kind: "farm.v1",
        schema_version: "v1",
        title: "North Orchard",
        current_revision: 2,
        created_by_user_id: "user-1",
        created_by_agent_id: "plodai-agent",
        last_edited_by_agent_id: "plodai-agent",
        summary: {
          crop_count: 1,
          order_count: 0,
        },
        latest_op: "farm.set_state",
        created_at: "2026-03-24T00:00:00Z",
        updated_at: "2026-03-24T00:05:00Z",
        payload: {
          version: "v1",
          farm_name: "North Orchard",
          location: "Block A",
          crops: [],
          orders: [],
          notes: null,
        } satisfies FarmItemPayloadV1,
      }),
      applyArtifactOperation: async (_artifactId, operation) => {
        appliedOperation = operation;
        return {
          origin: "created",
          id: "farm-existing",
          workspace_id: "workspace-1",
          kind: "farm.v1",
          schema_version: "v1",
          title: "North Orchard",
          current_revision: 3,
          created_by_user_id: "user-1",
          created_by_agent_id: "plodai-agent",
          last_edited_by_agent_id: "plodai-agent",
          summary: {
            crop_count: 1,
            order_count: 0,
          },
          latest_op: "farm.set_state",
          created_at: "2026-03-24T00:00:00Z",
          updated_at: "2026-03-24T00:10:00Z",
          payload: {
            version: "v1",
            farm_name: "North Orchard",
            location: "Block A",
            crops: [
              {
                id: "crop-1",
                name: "Walnut",
                area: "North field",
                expected_yield: null,
                notes: "Healthy canopy",
              },
            ],
            orders: [],
            notes: "Updated from another pass",
          } satisfies FarmItemPayloadV1,
        } satisfies WorkspaceCreatedItemDetail;
      },
    });

    const result = await executeLocalTool(workspace, "save_farm_state", {
      farm_name: "North Orchard",
      location: "Block A",
      crops: [
        {
          id: "crop-1",
          name: "Walnut",
          area: "North field",
          expected_yield: null,
          notes: "Healthy canopy",
        },
      ],
      notes: "Updated from another pass",
    });

    expect(createCalls).toBe(0);
    expect(appliedOperation?.operation.op).toBe("farm.set_state");
    expect(appliedOperation?.operation.farm_name).toBe("North Orchard");
    expect(result.payload.artifact_id).toBe("farm-existing");
  });
});
