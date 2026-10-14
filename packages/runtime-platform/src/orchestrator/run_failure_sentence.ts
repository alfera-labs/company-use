import { env } from '@coworker/config';
import { authentication_failure_pattern } from '@runtime-platform/workspace_model_credential_failure';

export const runtime_failure_text = "Something went wrong and I couldn't finish. Please try again.";

export type RunFailure = {
  message: string;
  sandbox_started?: boolean;
};

type KnownRunFailure = {
  is_the_cause_of: (failure: RunFailure) => boolean;
  sentence: string;
  has_no_fix_on_the_server?: true;
  fix_on_the_server?: string;
};

const no_tool_calling_pattern =
  /(does not support (tools?\b|tool[ _-]?(calls?|calling|use)|function[ _-]?calling)|support tool use|tool choice requires|tools param requires|tool[ _-]?(calling|use) is not supported)/iu;

const out_of_credit_pattern =
  /\b(402|insufficient[_ ]quota|insufficient[_ ](credits?|funds|balance)|credit balance is too low|exceeded your current quota|payment required|billing[_ ]hard[_ ]limit)\b/iu;

const refused_model_pattern =
  /\b(model[_ ]not[_ ]found|not_found_error|no such model|unknown model|model .{0,80}does not exist|model .{0,80}not found|do(es)? not have access to (the )?model|is not a valid model)\b/iu;

const request_declined_pattern =
  /\b(usage polic(y|ies)|content[_ ]policy|content[_ ]filter|safety system)/iu;

const known_run_failures: readonly KnownRunFailure[] = [
  {
    is_the_cause_of: (failure) => failure.sandbox_started === false,
    sentence: 'The sandbox could not start, so I did not run this.',
  },
  {
    is_the_cause_of: (failure) => no_tool_calling_pattern.test(failure.message),
    sentence: 'The model must support tool calling, and this one does not, so I could not answer.',
    fix_on_the_server:
      'On the server, run ./alfera add model and choose a model that supports tool calling.',
  },
  {
    is_the_cause_of: (failure) => failure.message.includes('does not support image input'),
    sentence: 'The model of this install reads no images, so I could not answer.',
    fix_on_the_server: 'Send the message without the image.',
  },
  {
    is_the_cause_of: (failure) => out_of_credit_pattern.test(failure.message),
    sentence: 'The model provider says the account is out of credit, so I could not answer.',
  },
  {
    is_the_cause_of: (failure) => refused_model_pattern.test(failure.message),
    sentence: 'The model provider refused the model, so I could not answer.',
  },
  {
    is_the_cause_of: (failure) => authentication_failure_pattern.test(failure.message),
    sentence: 'The model provider refused the API key, so I could not answer.',
  },
  {
    is_the_cause_of: (failure) => request_declined_pattern.test(failure.message),
    sentence:
      'The model provider declined this request under its usage policy, and rephrasing it may help.',
    has_no_fix_on_the_server: true,
  },
];

const self_host_fix_hint = 'On the server, run ./alfera doctor to find the fix.';

/**
 * The one sentence the chat shows for a failed run. On a self-hosted install the person runs
 * the server, so the sentence names the cause when it is a known one, and the command that
 * finds the fix when the fix is on the server. The hosted product keeps the plain sentence:
 * its raw causes are not for chat.
 */
export function run_failure_sentence(failure: RunFailure, install: { is_self_hosted: boolean }) {
  if (!install.is_self_hosted) return runtime_failure_text;
  const known = known_run_failures.find((candidate) => candidate.is_the_cause_of(failure));
  if (known?.has_no_fix_on_the_server) return known.sentence;
  return `${known?.sentence ?? runtime_failure_text} ${known?.fix_on_the_server ?? self_host_fix_hint}`;
}

export function run_failure_sentence_on_this_install(failure: RunFailure) {
  return run_failure_sentence(failure, { is_self_hosted: env.COWORKER_SELF_HOSTED });
}
