export const provider_billing_sentence = 'You pay your model provider for each token.';

/** The footer of the model list on an install that runs on the keys of its owner. */
export function ProviderBillingNote() {
  return (
    <p className="border-t px-3 py-2 text-muted-foreground text-xs">{provider_billing_sentence}</p>
  );
}
