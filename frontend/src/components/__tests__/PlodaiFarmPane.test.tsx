import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlodaiFarmPane } from "../PlodaiFarmPane";

describe("PlodaiFarmPane", () => {
  it("renders farm-scoped controls without JSON editing or farm search", () => {
    const markup = renderToStaticMarkup(<PlodaiFarmPane />);

    expect(markup).toContain("Farm");
    expect(markup).toContain("Overview");
    expect(markup).toContain("Orders");
    expect(markup).toContain("Rename");
    expect(markup).toContain("Edit description");
    expect(markup).toContain("Delete farm");
    expect(markup).not.toContain("Search");
    expect(markup).not.toContain("Edit JSON");
    expect(markup).not.toContain("Field photos and brief");
    expect(markup).not.toContain("Upload images");
    expect(markup).not.toContain("Optional investigation brief");
  });
});
