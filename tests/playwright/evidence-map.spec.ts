import { expect, test } from "@playwright/test";

test("renders walnut photo markers and highlights matching image evidence", async ({ page }) => {
  await page.route("**/api/advisory/cases/case_walnut_map/semantic-search", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    const payload = request.postDataJSON() as { query?: string; max_results?: number };
    expect(payload.query).toBe("bad walnut samples");
    expect(payload.max_results).toBe(8);

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        query: payload.query,
        indexed_item_count: 7,
        hits: [
          {
            item_type: "image",
            item_id: "walnut_bad_ones",
            title: "bad ones.jpeg",
            excerpt: "Damaged walnut sample with visible quality concerns.",
            score: 0.94,
            source_id: "source_walnut_bad_ones",
          },
        ],
      }),
    });
  });

  await page.goto("/playwright/evidence-map-fixture.html");

  await expect(page.getByRole("heading", { name: "Image map" })).toBeVisible();
  await expect(page.getByText("7 geotagged")).toBeVisible();
  await expect(page.getByTestId("evidence-map-canvas")).toBeVisible();
  await expect(page.getByTestId("evidence-map-marker")).toHaveCount(7);
  await expect(page.getByTestId("evidence-map-image")).toHaveCount(7);
  await expect(page.locator("[data-testid='evidence-map-image'][data-image-id='walnut_bad_ones']")).toContainText(
    "bad ones.jpeg",
  );
  await expect(page.getByTestId("evidence-map-image").filter({ hasText: "45.49248, 18.73518" })).toHaveCount(7);

  await expect(page.getByTestId("evidence-map-image").locator("img")).toHaveCount(7);
  await expect.poll(async () =>
    page.getByTestId("evidence-map-image").locator("img").evaluateAll(
      (images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
    ),
  ).toBe(true);

  await expect(page.locator("[data-testid='evidence-map-marker'][data-image-id='walnut_bad_ones']")).toHaveAttribute(
    "title",
    /bad ones\.jpeg.*45\.49248, 18\.73518/,
  );

  await page.getByLabel("Search saved image evidence").fill("bad walnut samples");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByText("Damaged walnut sample with visible quality concerns.")).toBeVisible();
  await expect(page.locator("[data-testid='evidence-map-marker'][data-image-id='walnut_bad_ones']")).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await expect(page.locator("[data-testid='evidence-map-image'][data-image-id='walnut_bad_ones']")).toHaveAttribute(
    "data-highlighted",
    "true",
  );
});
