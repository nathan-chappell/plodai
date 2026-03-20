export type JsonSchema =
  | JsonStringSchema
  | JsonNumberSchema
  | JsonIntegerSchema
  | JsonBooleanSchema
  | JsonNullSchema
  | JsonEnumSchema
  | JsonArraySchema
  | JsonObjectSchema
  | JsonAnyOfSchema;

type JsonSchemaBase = {
  description?: string;
  title?: string;
};

export type JsonStringSchema = JsonSchemaBase & {
  type: "string";
};

export type JsonNumberSchema = JsonSchemaBase & {
  type: "number";
  minimum?: number;
  maximum?: number;
};

export type JsonIntegerSchema = JsonSchemaBase & {
  type: "integer";
  minimum?: number;
  maximum?: number;
};

export type JsonBooleanSchema = JsonSchemaBase & {
  type: "boolean";
};

export type JsonNullSchema = JsonSchemaBase & {
  type: "null";
};

export type JsonEnumSchema = JsonSchemaBase & {
  enum: Array<string | number | boolean | null>;
};

export type JsonArraySchema = JsonSchemaBase & {
  type: "array";
  items: JsonSchema;
  minItems?: number;
  maxItems?: number;
};

export type JsonObjectSchema = JsonSchemaBase & {
  type: "object";
  properties: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties: false;
};

export type JsonAnyOfSchema = JsonSchemaBase & {
  anyOf: JsonSchema[];
};
