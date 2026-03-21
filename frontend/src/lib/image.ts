import type { LocalImageFile } from "../types/report";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

export function isImageExtension(extension: string): boolean {
  return IMAGE_EXTENSIONS.has(extension.trim().toLowerCase());
}

export function isImageMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.toLowerCase().startsWith("image/");
}

export function normalizeImageMimeType(
  mimeType: string | null | undefined,
  extension = "",
): string {
  const normalizedMimeType = mimeType?.trim().toLowerCase();
  if (normalizedMimeType && isImageMimeType(normalizedMimeType)) {
    return normalizedMimeType;
  }

  switch (extension.trim().toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

export function buildImageDataUrlFromBase64(
  bytesBase64: string,
  mimeType: string | null | undefined,
): string {
  return `data:${normalizeImageMimeType(mimeType)};base64,${bytesBase64}`;
}

export async function readImageDimensionsFromFile(
  file: File,
): Promise<{ width: number; height: number }> {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(imageUrl);
    return {
      width: image.naturalWidth || image.width || 0,
      height: image.naturalHeight || image.height || 0,
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function buildModelSafeImageDataUrl(
  file: LocalImageFile,
  options: {
    maxDimension?: number;
  } = {},
): Promise<string> {
  const mimeType = normalizeImageMimeType(file.mime_type, file.extension);
  const sourceDataUrl = buildImageDataUrlFromBase64(file.bytes_base64, mimeType);
  const maxDimension = Math.max(options.maxDimension ?? 1536, 256);
  const currentMaxDimension = Math.max(file.width, file.height);

  if (
    currentMaxDimension <= 0 ||
    currentMaxDimension <= maxDimension ||
    typeof document === "undefined" ||
    !supportsCanvasResizing(mimeType)
  ) {
    return sourceDataUrl;
  }

  const image = await loadImage(sourceDataUrl);
  const scale = maxDimension / Math.max(image.naturalWidth, image.naturalHeight);
  if (!Number.isFinite(scale) || scale >= 1) {
    return sourceDataUrl;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    return sourceDataUrl;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(mimeType, mimeType === "image/jpeg" ? 0.92 : undefined);
}

function supportsCanvasResizing(mimeType: string): boolean {
  return mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp";
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image."));
    image.src = src;
  });
}
