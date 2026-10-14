export class MissingModelProxyCredentialError extends Error {
  constructor(public readonly model_proxy: string) {
    super(`No API key configured for model proxy: ${model_proxy}`);
  }
}

export class MissingEveryModelProxyCredentialError extends Error {
  constructor(public readonly credential_env_names: string[]) {
    super(`No model proxy API key configured. Set ${credential_env_names.join(', ')}.`);
  }
}
