import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlodaiFarmPane } from "../PlodaiFarmPane";

describe("PlodaiFarmPane", () => {
  it("does not render the removed chat context card copy", () => {
    const markup = renderToStaticMarkup(<PlodaiFarmPane />);

    expect(markup).toContain("Search");
    expect(markup).not.toContain("Field photos and brief");
    expect(markup).not.toContain("Upload images");
    expect(markup).not.toContain("Optional investigation brief");
  });
});
