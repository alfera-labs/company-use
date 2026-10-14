export function reject_self_judge(
  candidate_model_name: string | null,
  judge_model: { model_name: string },
) {
  const candidate_identity = canonical_model_identity(candidate_model_name);
  const judge_identity = canonical_model_identity(judge_model.model_name);
  if (candidate_identity && candidate_identity === judge_identity) {
    throw new Error(`Judge model must differ from candidate model: ${judge_identity}`);
  }
}

function canonical_model_identity(model_name: string | null) {
  return model_name?.trim().toLowerCase().split('/').at(-1) ?? null;
}
