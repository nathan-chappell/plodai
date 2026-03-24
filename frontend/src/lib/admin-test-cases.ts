import type { WorkspaceAppId } from "../types/workspace";

export type AdminTestCaseFile = {
  name: string;
  publicPath: string;
  mimeType?: string;
};

export type AdminTestCase = {
  id: string;
  app_id: WorkspaceAppId;
  title: string;
  summary: string;
  prompt: string;
  model?: string;
  files: AdminTestCaseFile[];
};

const ADMIN_TEST_CASES: readonly AdminTestCase[] = [
  {
    id: "agriculture-orchard-photos",
    app_id: "agriculture",
    title: "Crop photo assessment",
    summary:
      "Loads a small crop-photo set and a prompt for crop identification, rough quantity, visible issues, and season-aware guidance.",
    prompt:
      "Inspect the loaded crop photos, identify the crop as specifically as the images support, estimate the visible amount or extent, flag likely issues with uncertainty, and explain what the crop likely needs at this point in the season.",
    model: "balanced",
    files: [
      {
        name: "bad ones.jpeg",
        publicPath: "/bad ones.jpeg",
        mimeType: "image/jpeg",
      },
      {
        name: "some good ones.jpeg",
        publicPath: "/some good ones.jpeg",
        mimeType: "image/jpeg",
      },
      {
        name: "drone photo.jpeg",
        publicPath: "/drone photo.jpeg",
        mimeType: "image/jpeg",
      },
    ],
  },
  {
    id: "documents-quarterly-packet",
    app_id: "documents",
    title: "Quarterly packet split",
    summary:
      "Loads a sample PDF packet and a prompt for inspection plus a useful section split.",
    prompt:
      "Inspect the loaded PDF packet, summarize its structure, and suggest the most useful smart split for review.",
    model: "balanced",
    files: [
      {
        name: "quarterly_packet.pdf",
        publicPath: "/fixtures/documents/quarterly_packet.pdf",
        mimeType: "application/pdf",
      },
    ],
  },
] as const;

export function listAdminTestCases(): readonly AdminTestCase[] {
  return ADMIN_TEST_CASES;
}

export async function loadAdminTestCaseFiles(
  testCase: AdminTestCase,
): Promise<File[]> {
  return Promise.all(
    testCase.files.map(async (fixtureFile) => {
      const response = await fetch(encodeURI(fixtureFile.publicPath));
      if (!response.ok) {
        throw new Error(`Unable to load test file ${fixtureFile.name}.`);
      }
      const blob = await response.blob();
      return new File([blob], fixtureFile.name, {
        type: fixtureFile.mimeType ?? blob.type,
      });
    }),
  );
}
