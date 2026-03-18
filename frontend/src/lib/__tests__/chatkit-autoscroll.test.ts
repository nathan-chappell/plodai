// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  findChatKitScrollTarget,
  isNearScrollBottom,
} from "../chatkit-autoscroll";

function setElementMetrics(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop?: number },
): void {
  let scrollTop = metrics.scrollTop ?? 0;
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
}

describe("chatkit auto-scroll helpers", () => {
  it("treats positions near the bottom as pinned", () => {
    expect(
      isNearScrollBottom({
        scrollTop: 552,
        clientHeight: 400,
        scrollHeight: 1000,
      }),
    ).toBe(true);
  });

  it("treats positions far from the bottom as unpinned", () => {
    expect(
      isNearScrollBottom({
        scrollTop: 420,
        clientHeight: 400,
        scrollHeight: 1000,
      }),
    ).toBe(false);
  });

  it("prefers the largest internal scroll target", () => {
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const outer = document.createElement("div");
    const transcript = document.createElement("div");
    outer.style.overflowY = "auto";
    transcript.style.overflowY = "auto";
    shadowRoot.append(outer, transcript);
    setElementMetrics(outer, { clientHeight: 500, scrollHeight: 760 });
    setElementMetrics(transcript, { clientHeight: 320, scrollHeight: 980 });

    expect(findChatKitScrollTarget(host)).toBe(transcript);
  });

  it("falls back to the pane surface when no internal target is available", () => {
    const host = document.createElement("div");
    const fallback = document.createElement("div");

    expect(findChatKitScrollTarget(host, fallback)).toBe(fallback);
  });
});
