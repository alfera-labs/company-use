export type HarnessSkill = {
  name: string;
  description: string;
  discovery_hint?: string;
  content: string;
  file_path: string;
  disable_model_invocation?: boolean;
};
