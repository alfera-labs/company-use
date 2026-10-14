export function out_of_credit_sentence(_upgrade_url: string) {
  return "This workspace cannot run right now, so I can't pick this one up yet. Ask your administrator, then send it again.";
}

export const model_lock_explanations = {
  locked_until_subscribed: 'This model is not open in this workspace.',
  gateway_not_funded: null,
} as const;

export const credit_refusal_reasons = {
  out_of_credits: 'The workspace cannot run right now',
  card_required: 'The workspace cannot run right now',
};

export const model_source_words = {
  install_source_label: 'The model key of this install',
  runs_use_own_account:
    'Runs bill the account you connected. The model key of this install is not used.',
  runs_use_install_source: 'Runs use the model key of this install.',
  disconnect_goes_back_to_install_source:
    'Runs go back to using the model key of this install. You can connect it again whenever you want.',
};
