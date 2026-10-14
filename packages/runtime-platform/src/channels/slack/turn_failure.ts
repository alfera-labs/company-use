export const slack_run_failure_text =
  "I hit a temporary issue and couldn't finish that request. Please try again.";

export function slack_turn_failure_text(run_status: string) {
  return run_status === 'cancelled' ? 'That request was cancelled.' : slack_run_failure_text;
}
