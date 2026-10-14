import model_ratings_data from '@api/services/models/model_ratings.json' with { type: 'json' };
import { parse_json_config } from '@coworker/shared';
import { z } from 'zod';

const model_rating_schema = z
  .object({
    speed_out_of_five: z.number().int().min(1).max(5),
    intelligence_out_of_five: z.number().int().min(1).max(5),
  })
  .strict();

const model_ratings_file_schema = z.object({
  comment: z.array(z.string()).optional(),
  rate_models_by_family: z.record(z.string().min(1), model_rating_schema),
  rate_these_exact_models: z.record(z.string().min(1), model_rating_schema),
});

export type ModelRating = z.infer<typeof model_rating_schema>;

const model_ratings = parse_json_config(
  'model_ratings.json',
  model_ratings_file_schema,
  model_ratings_data,
);

export function find_model_rating(model: {
  model_display_name: string;
  model_family: string | null;
}): ModelRating | null {
  const family_rating = model.model_family
    ? model_ratings.rate_models_by_family[model.model_family]
    : undefined;

  return model_ratings.rate_these_exact_models[model.model_display_name] ?? family_rating ?? null;
}
