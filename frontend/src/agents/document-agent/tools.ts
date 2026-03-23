import type { JsonSchema } from "../../types/json-schema";
import {
  buildToolDefinition,
} from "../shared/tool-helpers";
import type {
  AgentClientTool,
  AgentRuntimeContext,
  FunctionToolDefinition,
} from "../types";

const emptyObjectSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const documentFileIdSchema: JsonSchema = {
  type: "string",
};

const locatorIdSchema: JsonSchema = {
  type: "string",
};

const renderAsSchema: JsonSchema = {
  enum: ["table", "chart"],
};

const documentFieldValueSchema: JsonSchema = {
  type: "object",
  properties: {
    locator_id: { type: "string" },
    value: { type: "string" },
  },
  required: ["locator_id", "value"],
  additionalProperties: false,
};

export function buildDocumentAgentClientToolCatalog(
  _workspace: AgentRuntimeContext,
): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_document_files",
      "List thread-scoped document files available to the documents agent.",
      emptyObjectSchema,
      { label: "List Document Files" },
    ),
    buildToolDefinition(
      "inspect_document_file",
      "Inspect a stored PDF and return stable locator ids for text regions, form fields, and table/chart candidates.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          max_pages: { type: "integer", minimum: 1, maximum: 30 },
        },
        required: ["file_id"],
        additionalProperties: false,
      },
      {
        label: "Inspect Document",
        prominent_args: ["file_id", "max_pages"],
        arg_labels: { file_id: "file", max_pages: "max" },
      },
    ),
    buildToolDefinition(
      "replace_document_text",
      "Replace a text region in a PDF by locator id, using strict safe fallbacks when in-place replacement is not reliable.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          locator_id: locatorIdSchema,
          replacement_text: { type: "string" },
        },
        required: ["file_id", "locator_id", "replacement_text"],
        additionalProperties: false,
      },
      {
        label: "Replace Document Text",
        prominent_args: ["file_id", "locator_id"],
        arg_labels: { file_id: "file", locator_id: "locator" },
      },
    ),
    buildToolDefinition(
      "fill_document_form",
      "Fill PDF form fields by discovered locator id and report unresolved field locators explicitly.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          field_values: {
            type: "array",
            items: documentFieldValueSchema,
          },
        },
        required: ["file_id", "field_values"],
        additionalProperties: false,
      },
      {
        label: "Fill Document Form",
        prominent_args: ["file_id"],
        arg_labels: { file_id: "file" },
      },
    ),
    buildToolDefinition(
      "update_document_visual_from_dataset",
      "Update a document chart or table candidate from a CSV/JSON dataset, replacing in place only when the visual anchor is reliable.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          locator_id: locatorIdSchema,
          dataset_file_id: documentFileIdSchema,
          title: { type: "string" },
          render_as: renderAsSchema,
        },
        required: ["file_id", "locator_id", "dataset_file_id"],
        additionalProperties: false,
      },
      {
        label: "Update Document Visual",
        prominent_args: ["file_id", "locator_id", "dataset_file_id"],
        arg_labels: { file_id: "file", locator_id: "locator", dataset_file_id: "dataset" },
      },
    ),
    buildToolDefinition(
      "append_document_appendix_from_dataset",
      "Append a table or chart appendix generated from a thread-scoped dataset file.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          dataset_file_id: documentFileIdSchema,
          title: { type: "string" },
          render_as: renderAsSchema,
        },
        required: ["file_id", "dataset_file_id", "title"],
        additionalProperties: false,
      },
      {
        label: "Append Dataset Appendix",
        prominent_args: ["file_id", "dataset_file_id"],
        arg_labels: { file_id: "file", dataset_file_id: "dataset" },
      },
    ),
    buildToolDefinition(
      "smart_split_document",
      "Split a PDF into useful derived files, plus an index and ZIP bundle, all stored in the current document thread.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          goal: { type: "string" },
        },
        required: ["file_id"],
        additionalProperties: false,
      },
      {
        label: "Smart Split Document",
        prominent_args: ["file_id", "goal"],
        arg_labels: { file_id: "file", goal: "goal" },
      },
    ),
    buildToolDefinition(
      "delete_document_file",
      "Delete a thread-scoped document file from the current document thread.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
        },
        required: ["file_id"],
        additionalProperties: false,
      },
      {
        label: "Delete Document File",
        prominent_args: ["file_id"],
        arg_labels: { file_id: "file" },
      },
    ),
  ];
}

export function createDocumentAgentClientTools(
  _workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return [];
}
