export type PlodaiEntityType =
  | "farm_image"
  | "farm_crop"
  | "farm_work_item"
  | "farm_order";

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
