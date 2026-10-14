import { type ModelAccessRules, unrestricted_model_access } from '@coworker/shared';

export function useModelAccess(): ModelAccessRules {
  return unrestricted_model_access;
}
