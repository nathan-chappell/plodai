// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WritingPage } from "../WritingPage";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("WritingPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
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

  it("renders curated published writing links and hides unpublished draft entries", async () => {
    await act(async () => {
      root.render(<WritingPage />);
    });

    expect(container.querySelector("[data-testid='writing-page']")).not.toBeNull();
    expect(container.textContent).toContain("Intro to ChatGPT");
    expect(container.textContent).toContain("Case Study: AI-enabled Virtual Assistants");
    expect(container.textContent).toContain("Mono");
    expect(container.textContent).toContain("2024");
    expect(container.textContent).not.toContain("The Theoretical Justification of Neural Networks");
    expect(container.textContent).not.toContain("AI and the Old Gods");
  });
});
