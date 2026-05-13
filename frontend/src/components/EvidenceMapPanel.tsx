import { FormEvent, useMemo, useState } from "react";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import { publishToast } from "../app/toasts";
import { searchAdvisoryMemory } from "../lib/api";
import type { AdvisoryImageSummary, AdvisorySemanticSearchHit } from "../types/advisory";

type EvidenceMapPanelProps = {
  caseId: string;
  images: AdvisoryImageSummary[];
};

type GeotaggedImage = AdvisoryImageSummary & {
  latitude: number;
  longitude: number;
};

export function EvidenceMapPanel({ caseId, images }: EvidenceMapPanelProps) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<AdvisorySemanticSearchHit[]>([]);
  const [skippedReason, setSkippedReason] = useState<string | null>(null);

  const geotaggedImages = useMemo(
    () =>
      images
        .filter((image): image is GeotaggedImage => (
          typeof image.latitude === "number" &&
          Number.isFinite(image.latitude) &&
          typeof image.longitude === "number" &&
          Number.isFinite(image.longitude)
        ))
        .sort((first, second) => first.name.localeCompare(second.name)),
    [images],
  );
  const highlightedImageIds = useMemo(
    () => new Set(hits.filter((hit) => hit.item_type === "image").map((hit) => hit.item_id)),
    [hits],
  );
  const projection = useMemo(() => buildProjection(geotaggedImages), [geotaggedImages]);
  const imageHits = hits.filter((hit) => hit.item_type === "image");

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedQuery = query.trim();
    if (!cleanedQuery) {
      setHits([]);
      setSkippedReason(null);
      return;
    }

    setSearching(true);
    try {
      const response = await searchAdvisoryMemory({
        caseId,
        query: cleanedQuery,
        maxResults: 8,
      });
      setHits(response.hits);
      setSkippedReason(response.skipped_reason ?? null);
    } catch (error) {
      publishToast({
        title: "Unable to search image evidence",
        message: error instanceof Error ? error.message : "Image evidence search failed.",
        tone: "error",
      });
    } finally {
      setSearching(false);
    }
  }

  return (
    <EvidenceSection>
      <EvidenceHeader>
        <div>
          <EvidenceEyebrow>Field evidence</EvidenceEyebrow>
          <EvidenceTitle>Image map</EvidenceTitle>
        </div>
        <EvidenceCount>{geotaggedImages.length} geotagged</EvidenceCount>
      </EvidenceHeader>

      <EvidenceSearch onSubmit={(event) => void handleSearch(event)}>
        <EvidenceSearchInput
          aria-label="Search saved image evidence"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search saved image evidence"
          type="search"
          value={query}
        />
        <EvidenceSearchButton disabled={searching} type="submit">
          {searching ? "Searching" : "Search"}
        </EvidenceSearchButton>
      </EvidenceSearch>

      {geotaggedImages.length ? (
        <MapCanvas aria-label="Geotagged advisory image map" data-testid="evidence-map-canvas">
          <MapGrid />
          {geotaggedImages.map((image) => {
            const point = projection(image);
            const highlighted = highlightedImageIds.has(image.id);
            return (
              <MapMarker
                key={image.id}
                $highlighted={highlighted}
                data-highlighted={highlighted ? "true" : "false"}
                data-image-id={image.id}
                data-testid="evidence-map-marker"
                style={{
                  left: `${point.x}%`,
                  top: `${point.y}%`,
                }}
                title={markerTitle(image)}
                type="button"
              >
                <span />
              </MapMarker>
            );
          })}
        </MapCanvas>
      ) : (
        <MapEmptyState>
          <strong>No geotagged images yet</strong>
          <MetaText>Images with EXIF GPS or saved coordinates will appear here.</MetaText>
        </MapEmptyState>
      )}

      {skippedReason ? <MetaText>{skippedReason}</MetaText> : null}
      {imageHits.length ? (
        <HitList>
          {imageHits.map((hit) => (
            <HitItem key={`${hit.source_id}-${hit.item_id}`}>
              <strong>{hit.title}</strong>
              <span>{hit.excerpt}</span>
            </HitItem>
          ))}
        </HitList>
      ) : null}

      {geotaggedImages.length ? (
        <ImageList>
          {geotaggedImages.map((image) => (
            <ImageListItem
              key={image.id}
              $highlighted={highlightedImageIds.has(image.id)}
              data-highlighted={highlightedImageIds.has(image.id) ? "true" : "false"}
              data-image-id={image.id}
              data-testid="evidence-map-image"
            >
              {image.preview_url ? (
                <ImageThumb alt="" src={image.preview_url} />
              ) : null}
              <ImageText>
                <strong>{image.name}</strong>
                <span>{formatCoordinates(image)}</span>
                {image.location_label ? <span>{image.location_label}</span> : null}
              </ImageText>
            </ImageListItem>
          ))}
        </ImageList>
      ) : null}
    </EvidenceSection>
  );
}

function buildProjection(images: GeotaggedImage[]) {
  if (images.length <= 1) {
    return () => ({
      x: 50,
      y: 50,
    });
  }

  const latitudes = images.map((image) => image.latitude);
  const longitudes = images.map((image) => image.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.0001);
  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.0001);

  return (image: GeotaggedImage) => ({
    x: 8 + ((image.longitude - minLongitude) / longitudeSpan) * 84,
    y: 92 - ((image.latitude - minLatitude) / latitudeSpan) * 84,
  });
}

function markerTitle(image: GeotaggedImage): string {
  return [
    image.name,
    image.location_label,
    formatCoordinates(image),
  ].filter(Boolean).join(" | ");
}

function formatCoordinates(image: GeotaggedImage): string {
  return `${image.latitude.toFixed(5)}, ${image.longitude.toFixed(5)}`;
}

const EvidenceSection = styled.section`
  display: grid;
  gap: 0.68rem;
  padding: 0.75rem 0.82rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.78);
`;

const EvidenceHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.58rem;
`;

const EvidenceEyebrow = styled.div`
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--accent-deep) 74%, var(--ink) 26%);
`;

const EvidenceTitle = styled.h5`
  margin: 0.16rem 0 0;
  font-size: 0.95rem;
  line-height: 1.1;
`;

const EvidenceCount = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 1.55rem;
  padding: 0.16rem 0.54rem;
  border-radius: 999px;
  background: rgba(117, 158, 126, 0.12);
  color: var(--accent-deep);
  font-size: 0.72rem;
  font-weight: 800;
`;

const EvidenceSearch = styled.form`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.42rem;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const EvidenceSearchInput = styled.input`
  min-width: 0;
  min-height: 2.18rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.42rem 0.66rem;
  background: rgba(255, 255, 255, 0.82);
  color: var(--ink);
  font: inherit;
  font-size: 0.84rem;
`;

const EvidenceSearchButton = styled.button`
  min-height: 2.18rem;
  border: 0;
  border-radius: var(--radius-md);
  padding: 0.38rem 0.78rem;
  background: var(--accent);
  color: white;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 800;
  cursor: pointer;

  &:disabled {
    cursor: wait;
    opacity: 0.68;
  }
`;

const MapCanvas = styled.div`
  position: relative;
  min-height: 270px;
  border-radius: 0.8rem;
  border: 1px solid rgba(31, 41, 55, 0.1);
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(232, 239, 228, 0.82), rgba(247, 247, 240, 0.92)),
    linear-gradient(90deg, rgba(92, 122, 153, 0.08), transparent 42%),
    rgba(244, 246, 239, 0.9);
`;

const MapGrid = styled.div`
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(31, 41, 55, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(31, 41, 55, 0.08) 1px, transparent 1px);
  background-size: 18% 18%;
  opacity: 0.56;
`;

const MapMarker = styled.button<{ $highlighted: boolean }>`
  position: absolute;
  transform: translate(-50%, -50%);
  width: ${({ $highlighted }) => ($highlighted ? "1.32rem" : "1.05rem")};
  height: ${({ $highlighted }) => ($highlighted ? "1.32rem" : "1.05rem")};
  border-radius: 999px;
  border: 2px solid white;
  background: ${({ $highlighted }) => ($highlighted ? "#ba5c4e" : "var(--accent)")};
  box-shadow: 0 0 0 ${({ $highlighted }) => ($highlighted ? "5px" : "3px")}
    ${({ $highlighted }) => ($highlighted ? "rgba(186, 92, 78, 0.22)" : "rgba(21, 128, 61, 0.2)")};
  cursor: pointer;

  span {
    position: absolute;
    left: 50%;
    top: 100%;
    width: 2px;
    height: 0.5rem;
    transform: translateX(-50%);
    background: inherit;
  }
`;

const MapEmptyState = styled.div`
  min-height: 180px;
  display: grid;
  align-content: center;
  gap: 0.32rem;
  padding: 1rem;
  border-radius: 0.8rem;
  border: 1px dashed rgba(31, 41, 55, 0.18);
  background: rgba(255, 255, 255, 0.52);
`;

const HitList = styled.div`
  display: grid;
  gap: 0.42rem;
`;

const HitItem = styled.div`
  display: grid;
  gap: 0.16rem;
  padding: 0.55rem 0.62rem;
  border-radius: 0.7rem;
  border: 1px solid rgba(186, 92, 78, 0.2);
  background: rgba(255, 244, 242, 0.74);
  font-size: 0.78rem;

  span {
    color: var(--muted);
    line-height: 1.4;
  }
`;

const ImageList = styled.div`
  display: grid;
  gap: 0.44rem;
`;

const ImageListItem = styled.div<{ $highlighted: boolean }>`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.54rem;
  min-width: 0;
  padding: 0.48rem;
  border-radius: 0.74rem;
  border: 1px solid ${({ $highlighted }) => ($highlighted ? "rgba(186, 92, 78, 0.34)" : "rgba(31, 41, 55, 0.08)")};
  background: ${({ $highlighted }) => ($highlighted ? "rgba(255, 244, 242, 0.7)" : "rgba(255, 255, 255, 0.62)")};
`;

const ImageThumb = styled.img`
  width: 3rem;
  height: 3rem;
  border-radius: 0.56rem;
  object-fit: cover;
  border: 1px solid rgba(31, 41, 55, 0.08);
`;

const ImageText = styled.div`
  min-width: 0;
  display: grid;
  gap: 0.14rem;
  font-size: 0.78rem;

  strong,
  span {
    overflow-wrap: anywhere;
  }

  span {
    color: var(--muted);
  }
`;
