export const not_in_this_edition_code = 'not_in_this_edition';

export class NotInThisEditionError extends Error {
  readonly code = not_in_this_edition_code;
  readonly feature_name: string;

  constructor(feature_name: string) {
    super(`${feature_name} runs on Alfera Cloud. It is not in this edition.`);
    this.name = 'NotInThisEditionError';
    this.feature_name = feature_name;
  }
}

export function not_in_this_edition(feature_name: string): never {
  throw new NotInThisEditionError(feature_name);
}
