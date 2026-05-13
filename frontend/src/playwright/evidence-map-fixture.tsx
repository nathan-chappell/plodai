import React from "react";
import ReactDOM from "react-dom/client";
import { createGlobalStyle } from "styled-components";

import { EvidenceMapPanel } from "../components/EvidenceMapPanel";
import type { AdvisoryImageSummary } from "../types/advisory";

import badOnesUrl from "../../../walnut_test_images/bad ones.jpeg?url";
import dronePhotoUrl from "../../../walnut_test_images/drone photo.jpeg?url";
import goodOnesOnTreeUrl from "../../../walnut_test_images/good ones on tree.jpeg?url";
import harvestWithTheBoysUrl from "../../../walnut_test_images/harvest with the boys.jpeg?url";
import moreBadOnesUrl from "../../../walnut_test_images/more bad ones.jpeg?url";
import sanitationUrl from "../../../walnut_test_images/sanitation.jpeg?url";
import someGoodOnesUrl from "../../../walnut_test_images/some good ones.jpeg?url";

const FALLBACK_LATITUDE = 45.492483;
const FALLBACK_LONGITUDE = 18.735175;

const walnutImages: AdvisoryImageSummary[] = [
  imageSummary("walnut_good_on_tree", "good ones on tree.jpeg", goodOnesOnTreeUrl, "Walnut tree row"),
  imageSummary("walnut_some_good_ones", "some good ones.jpeg", someGoodOnesUrl, "Walnut sample table"),
  imageSummary("walnut_harvest_boys", "harvest with the boys.jpeg", harvestWithTheBoysUrl, "Walnut harvest"),
  imageSummary("walnut_drone_photo", "drone photo.jpeg", dronePhotoUrl, "Walnut block aerial"),
  imageSummary("walnut_bad_ones", "bad ones.jpeg", badOnesUrl, "Damaged walnut sample"),
  imageSummary("walnut_more_bad_ones", "more bad ones.jpeg", moreBadOnesUrl, "Damaged walnut follow-up"),
  imageSummary("walnut_sanitation", "sanitation.jpeg", sanitationUrl, "Walnut sanitation"),
];

const GlobalStyle = createGlobalStyle`
  :root {
    --ink: #1f2937;
    --muted: #5d6b7b;
    --line: rgba(31, 41, 55, 0.14);
    --accent: #c96f3b;
    --accent-deep: #8f4320;
    --radius-md: 14px;
    color-scheme: light;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    padding: 24px;
    font-family: "Manrope", "Segoe UI", sans-serif;
    color: var(--ink);
    background: #f4efe7;
  }

  button,
  input {
    font: inherit;
  }

  #root {
    max-width: 920px;
    margin: 0 auto;
  }
`;

function imageSummary(
  id: string,
  name: string,
  previewUrl: string,
  locationLabel: string,
): AdvisoryImageSummary {
  return {
    id,
    case_id: "case_walnut_map",
    chat_id: "chat_walnut_map",
    attachment_id: null,
    source_kind: "upload",
    name,
    mime_type: "image/jpeg",
    byte_size: 1000,
    width: 1200,
    height: 900,
    detailed_description: `${name} walnut evidence fixture.`,
    location_label: locationLabel,
    latitude: FALLBACK_LATITUDE,
    longitude: FALLBACK_LONGITUDE,
    preview_url: previewUrl,
    created_at: "2026-05-13T10:00:00Z",
    updated_at: "2026-05-13T10:00:00Z",
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GlobalStyle />
    <EvidenceMapPanel caseId="case_walnut_map" images={walnutImages} />
  </React.StrictMode>,
);
