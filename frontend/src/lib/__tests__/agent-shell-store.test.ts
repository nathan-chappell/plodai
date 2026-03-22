import { describe, expect, it, vi } from "vitest";

import {
  clearWorkspaceStorage,
  DEFAULT_WORKSPACE_CONTEXT_ID,
  DEFAULT_WORKSPACE_CONTEXT_NAME,
} from "../agent-shell-store";
import * as kvStore from "../kv-store";

describe("agent-shell-store", () => {
  it("exports the default workspace constants", () => {
    expect(DEFAULT_WORKSPACE_CONTEXT_ID).toBe("workspace-default");
    expect(DEFAULT_WORKSPACE_CONTEXT_NAME).toBe("Workspace");
  });

  it("clears the v1 workspace storage keys without running a migration", async () => {
    const removeStoredValueSpy = vi.spyOn(kvStore, "removeStoredValue").mockResolvedValue();

    await clearWorkspaceStorage("user_123");

    expect(removeStoredValueSpy).toHaveBeenCalledTimes(2);
    expect(removeStoredValueSpy).toHaveBeenNthCalledWith(1, "workspace-v1:contexts:user_123");
    expect(removeStoredValueSpy).toHaveBeenNthCalledWith(2, "workspace-v1:active-context:user_123");
  });
});
