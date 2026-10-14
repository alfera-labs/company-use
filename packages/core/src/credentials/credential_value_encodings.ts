import { createHash, createHmac } from 'node:crypto';

export type ValueEncodingInputs = {
  value: string;
  username?: string | undefined;
  salt?: string | undefined;
  message?: string | undefined;
  access_key_id?: string | undefined;
  region?: string | undefined;
  service?: string | undefined;
};

export type ValueEncoding = {
  needs: readonly (keyof ValueEncodingInputs)[];
  apply: (inputs: ValueEncodingInputs) => string;
};

export const value_encodings = {
  as_is: {
    needs: [],
    apply: ({ value }) => value,
  },
  url_encoded: {
    needs: [],
    apply: ({ value }) => encodeURIComponent(value),
  },
  base64: {
    needs: [],
    apply: ({ value }) => Buffer.from(value).toString('base64'),
  },
  md5: {
    needs: [],
    apply: ({ value }) => createHash('md5').update(value).digest('hex'),
  },
  sha1: {
    needs: [],
    apply: ({ value }) => createHash('sha1').update(value).digest('hex'),
  },
  sha256: {
    needs: [],
    apply: ({ value }) => createHash('sha256').update(value).digest('hex'),
  },
  sha512: {
    needs: [],
    apply: ({ value }) => createHash('sha512').update(value).digest('hex'),
  },
  basic_auth: {
    needs: ['username'],
    apply: ({ username, value }) => Buffer.from(`${username}:${value}`).toString('base64'),
  },
  salted_sha256: {
    needs: ['salt'],
    apply: ({ salt, value }) => createHash('sha256').update(`${salt}${value}`).digest('hex'),
  },
  hmac_sha256: {
    needs: ['message'],
    apply: ({ message, value }) =>
      createHmac('sha256', value)
        .update(message as string)
        .digest('hex'),
  },
} satisfies Record<string, ValueEncoding>;

export type ValueEncodingName = keyof typeof value_encodings;

function find_missing_input(
  encoding: ValueEncoding,
  inputs: ValueEncodingInputs,
): keyof ValueEncodingInputs | undefined {
  return encoding.needs.find((needed_input) => !inputs[needed_input]);
}

export function apply_value_encoding(name: string, inputs: ValueEncodingInputs): string {
  const encoding = value_encodings[name as ValueEncodingName] as ValueEncoding | undefined;
  if (!encoding) {
    throw new Error(`unknown_value_encoding:${name}`);
  }

  const missing_input = find_missing_input(encoding, inputs);
  if (missing_input) {
    throw new Error(`value_encoding_needs_${missing_input}:${name}`);
  }

  return encoding.apply(inputs);
}

export function find_value_encoding_that_produced(
  plaintext: string,
  appears_in: string,
  inputs: Omit<ValueEncodingInputs, 'value'>,
): { encoding: ValueEncodingName; rendered: string; index: number } | null {
  const complete_inputs = { ...inputs, value: plaintext };

  for (const [encoding_name, encoding] of Object.entries(value_encodings)) {
    if (find_missing_input(encoding, complete_inputs)) {
      continue;
    }

    const rendered = encoding.apply(complete_inputs);
    const index = appears_in.indexOf(rendered);
    if (index !== -1) {
      return { encoding: encoding_name as ValueEncodingName, rendered, index };
    }
  }

  return null;
}
