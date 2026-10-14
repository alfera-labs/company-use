-- An agent with no pinned model lets the platform recommend one from model_use_cases.json,
-- so "no default model" has to be storable. Before this the column was NOT NULL and the only
-- way out of a pinned model was to pin a different one.
ALTER TABLE "agents" ALTER COLUMN "default_model" DROP NOT NULL;
