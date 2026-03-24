// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateSpy = vi.fn();

vi.mock("../../lib/router", () => ({
  navigate: (path: string) => navigateSpy(path),
  isFarmOrderPath: (path: string) => path.startsWith("/farm-orders/"),
}));

import { useAppRouteGuards } from "../hooks";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function RouteGuardHarness(props: Parameters<typeof useAppRouteGuards>[0]) {
  useAppRouteGuards(props);
  return null;
}

describe("useAppRouteGuards", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    navigateSpy.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function renderRouteGuard(
    props: Partial<Parameters<typeof useAppRouteGuards>[0]> = {},
  ) {
    await act(async () => {
      root.render(
        <RouteGuardHarness
          authError={null}
          hydrating={false}
          pathname="/"
          user={null}
          {...props}
        />,
      );
    });
  }

  it("sends signed-out root traffic to sign-in", async () => {
    await renderRouteGuard({ pathname: "/" });
    expect(navigateSpy).toHaveBeenCalledWith("/sign-in");
  });

  it("keeps /writing public for signed-out users", async () => {
    await renderRouteGuard({ pathname: "/writing" });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("keeps public farm order links open for signed-out users", async () => {
    await renderRouteGuard({ pathname: "/farm-orders/workspace_1/order_1" });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

});
