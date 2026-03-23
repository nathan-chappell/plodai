import { decodeBase64ToBytes } from "./base64";
import { rowsToCsv, rowsToJson } from "./workspace-files";
import type { LocalAttachment } from "../types/report";

export function buildWorkspaceFilePayload(file: LocalAttachment): { filename: string; blob: Blob } {
  if (file.kind === "csv") {
    return {
      filename: file.name,
      blob: new Blob([rowsToCsv(file.rows)], {
        type: file.mime_type || "text/csv",
      }),
    };
  }

  if (file.kind === "json") {
    return {
      filename: file.name,
      blob: new Blob([file.json_text || rowsToJson(file.rows)], {
        type: file.mime_type || "application/json",
      }),
    };
  }

  if (file.kind === "pdf" && file.bytes_base64) {
    return {
      filename: file.name,
      blob: new Blob([toArrayBuffer(decodeBase64ToBytes(file.bytes_base64))], {
        type: file.mime_type || "application/pdf",
      }),
    };
  }

  if (file.kind === "image") {
    return {
      filename: file.name,
      blob: new Blob([toArrayBuffer(decodeBase64ToBytes(file.bytes_base64))], {
        type: file.mime_type || "image/png",
      }),
    };
  }

  if (file.kind === "other") {
    if (file.text_content != null) {
      return {
        filename: file.name,
        blob: new Blob([file.text_content], {
          type: file.mime_type || "text/plain",
        }),
      };
    }
    if (file.bytes_base64) {
      return {
        filename: file.name,
        blob: new Blob([toArrayBuffer(decodeBase64ToBytes(file.bytes_base64))], {
          type: file.mime_type || "application/octet-stream",
        }),
      };
    }
  }

  return {
    filename: file.name,
    blob: new Blob([], {
      type: file.mime_type || "application/octet-stream",
    }),
  };
}

export function downloadWorkspaceFile(file: LocalAttachment) {
  const payload = buildWorkspaceFilePayload(file);
  const url = URL.createObjectURL(payload.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = payload.filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function openWorkspaceFileInNewTab(file: LocalAttachment) {
  const payload = buildWorkspaceFilePayload(file);
  const url = URL.createObjectURL(payload.blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatByteSize(bytes?: number): string {
  if (!bytes || bytes < 0) {
    return "Unknown size";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
