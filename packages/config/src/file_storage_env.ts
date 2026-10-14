import { z } from 'zod';

export const file_storage_env_schema = {
  MEMORY_IMPORT_BUCKET: z.string().min(3).optional(),
  ARTIFACT_UPLOAD_BUCKET: z.string().min(3).optional(),
  COWORKER_FILE_STORAGE_PATH: z.string().min(1).optional(),
};
