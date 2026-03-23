import {
  fetchStoredFileBlob,
  searchAgricultureEntities,
} from "../../lib/api";
import { buildModelSafeImageDataUrl } from "../../lib/image";
import {
  getFarmStateToolSchema,
  inspectImageFileToolSchema,
  listImageFilesToolSchema,
  saveFarmStateToolSchema,
} from "../../lib/tool-schemas";
import { getFileExtension, buildWorkspaceFile } from "../../lib/workspace-files";
import type { InspectImageFileToolArgs } from "../../types/analysis";
import type { LocalImageAttachment } from "../../types/report";
import {
  buildToolDefinition,
  createBrokeredAgentTool,
} from "../shared/tool-helpers";
import type {
  AgentClientTool,
  AgentRuntimeContext,
  FunctionToolDefinition,
} from "../types";

type AgricultureThreadImage = {
  fileId: string;
  name: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
};

export function buildAgricultureAgentImageToolCatalog(): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_image_files",
      "List image exports so the model can select the right plant or field photo.",
      listImageFilesToolSchema,
      {
        label: "List Image Files",
      },
    ),
    buildToolDefinition(
      "inspect_image_file",
      "Prepare an image export for visual inspection by returning image metadata plus an imageDataUrl that ChatKit forwards to the model as vision input.",
      inspectImageFileToolSchema,
      {
        label: "Inspect Image File",
        prominent_args: ["file_id"],
        arg_labels: { file_id: "image" },
      },
    ),
  ];
}

export function buildAgricultureAgentFarmToolCatalog(): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "get_farm_state",
      "Read the saved farm record with crops, issues, projects, and current work for this workspace.",
      getFarmStateToolSchema,
      {
        label: "Get Farm State",
      },
    ),
    buildToolDefinition(
      "save_farm_state",
      "Create or replace the saved farm record for this workspace after merging any updates the user asked for.",
      saveFarmStateToolSchema,
      {
        label: "Save Farm State",
        prominent_args: ["farm_name"],
        arg_labels: { farm_name: "farm" },
      },
    ),
  ];
}

export function createAgricultureAgentImageTools(
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return buildAgricultureAgentImageToolCatalog().map((definition) => {
    if (definition.name === "list_image_files") {
      return {
        ...definition,
        handler: async () => {
          const images = await listAgricultureThreadImages(workspace);
          const payload = images.map((image) => ({
            id: image.fileId,
            name: image.name,
            kind: "image",
            extension: getFileExtension(image.name),
            mime_type: image.mimeType,
            origin: "chat_attachment",
            scope: "chat_attachment",
            width: image.width ?? undefined,
            height: image.height ?? undefined,
          }));
          return {
            image_files: payload,
            files: payload,
          };
        },
      } satisfies AgentClientTool;
    }

    return {
      ...definition,
      handler: async (args) => {
        const toolArgs = args as InspectImageFileToolArgs;
        const image = await getAgricultureThreadImage(workspace, toolArgs.file_id);
        const blob = await fetchStoredFileBlob(image.fileId);
        const localFile = await buildWorkspaceFile(
          new File([blob], image.name, {
            type: image.mimeType || blob.type || "image/png",
          }),
          { id: image.fileId },
        );

        if (localFile.kind !== "image") {
          throw new Error(`Stored file ${image.fileId} is not an image.`);
        }

        return buildInspectedImagePayload(localFile, toolArgs.max_dimension);
      },
    } satisfies AgentClientTool;
  });
}

export function createAgricultureAgentFarmTools(
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return buildAgricultureAgentFarmToolCatalog().map((definition) =>
    createBrokeredAgentTool(
      workspace,
      definition,
      definition.name as "get_farm_state" | "save_farm_state",
    ),
  );
}

async function listAgricultureThreadImages(
  workspace: AgentRuntimeContext,
): Promise<AgricultureThreadImage[]> {
  if (!workspace.activeThreadId) {
    return [];
  }

  const response = await searchAgricultureEntities({
    appId: "agriculture",
    workspaceId: workspace.workspaceId,
    threadId: workspace.activeThreadId,
    query: "",
  });

  return response.entities
    .filter((entity) => entity.data.entity_type === "thread_image")
    .map((entity) => ({
      fileId: entity.data.file_id,
      name: entity.title,
      mimeType: entity.data.mime_type || null,
      width: parseEntityDimension(entity.data.width),
      height: parseEntityDimension(entity.data.height),
    }));
}

async function getAgricultureThreadImage(
  workspace: AgentRuntimeContext,
  fileId: string,
): Promise<AgricultureThreadImage> {
  const image = (await listAgricultureThreadImages(workspace)).find(
    (candidate) => candidate.fileId === fileId,
  );
  if (!image) {
    throw new Error(`Unknown agriculture image: ${fileId}`);
  }
  return image;
}

function parseEntityDimension(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function buildInspectedImagePayload(
  file: LocalImageAttachment,
  maxDimension: number | undefined,
) {
  return {
    file_id: file.id,
    name: file.name,
    kind: file.kind,
    width: file.width,
    height: file.height,
    mime_type: file.mime_type,
    byte_size: file.byte_size,
    imageDataUrl: await buildModelSafeImageDataUrl(file, {
      maxDimension: maxDimension ?? 1536,
    }),
  };
}
