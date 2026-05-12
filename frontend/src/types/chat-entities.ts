export type PlodaiEntityType =
  | "advisory_image"
  | "advisory_subject"
  | "advisory_report"
  | "advisory_query"
  | "advisory_measurement"
  | "advisory_material";

export type PlodaiComposerEntity = {
  id: string;
  title: string;
  icon?: string;
  interactive?: boolean;
  group?: string;
  data: Record<string, string>;
};

export type PlodaiEntitySearchResponse = {
  entities: PlodaiComposerEntity[];
};
