export type AgricultureEntityType =
  | "thread_image"
  | "farm_crop"
  | "farm_issue"
  | "farm_project"
  | "farm_current_work";

export type AgricultureComposerEntity = {
  id: string;
  title: string;
  icon?: string;
  interactive?: boolean;
  group?: string;
  data: Record<string, string>;
};

export type AgricultureEntitySearchResponse = {
  entities: AgricultureComposerEntity[];
};
