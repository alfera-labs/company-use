// The installer on the server writes one JSON object per line. This file reads those lines and
// says what they mean: which rows of the setup screen are done, and how the run ended.
const { one_line_of } = require('./plain_text.cjs');

const exit_code_of_ssh_itself = 255;

// Text arrives in pieces of any size, so a line can come in two pieces.
function create_line_reader() {
  let unfinished = '';
  return {
    read(piece) {
      const lines = (unfinished + piece).split('\n');
      unfinished = lines.pop();
      return lines.filter((line) => line.trim() !== '');
    },
    read_the_rest() {
      const rest = unfinished.trim();
      unfinished = '';
      return rest === '' ? [] : [rest];
    },
  };
}

// Returns the line as an object, or null when it is not a progress line.
function parse_progress_line(text) {
  let line;
  try {
    line = JSON.parse(text);
  } catch {
    return null;
  }
  const is_a_progress_line = typeof line?.step === 'string' && typeof line?.state === 'string';
  return is_a_progress_line ? line : null;
}

// How a run ended. `last_step` is the step whose "done" line ends this kind of run.
function read_run_outcome({ lines, exit_code, last_step }) {
  const failed = lines.find((line) => line.state === 'failed');
  if (failed) {
    return { kind: 'failed', reason: failed.reason ?? 'unlisted', message: one_line_of(failed.message ?? '') };
  }
  const last = lines.at(-1);
  if (exit_code === 0 && last?.step === last_step && last.state === 'done') return { kind: 'done', ...last };
  if (exit_code === exit_code_of_ssh_itself || exit_code === null) return { kind: 'connection_lost' };
  return { kind: lines.length === 0 ? 'did_not_start' : 'stopped' };
}

// One state for each row of the setup screen. A row covers one or more steps of the installer.
// A row is done only when the installer said "done" for every step of it that it named. A row
// the installer never named waits, also when later rows are under way. A step this app does not
// know moves no row. A row with two steps is done once a later row has begun: between its two
// steps it stays under way, so no row steps back.
function read_row_states(rows, lines) {
  const said = (step, state) => lines.some((line) => line.step === step && line.state === state);
  const named = (step) => lines.some((line) => line.step === step);
  const install_is_done = said('install', 'done');
  const last_row_named = rows.findLastIndex((row) => row.steps.some(named));
  return rows.map((row, index) => {
    const steps_named = row.steps.filter(named);
    if (steps_named.length === 0) return 'waiting';
    if (steps_named.some((step) => said(step, 'failed'))) return 'failed';
    const every_step_is_done = steps_named.every((step) => said(step, 'done'));
    const no_step_can_follow = row.steps.length === 1 || index < last_row_named || install_is_done;
    return every_step_is_done && no_step_can_follow ? 'done' : 'working';
  });
}

module.exports = { create_line_reader, parse_progress_line, read_run_outcome, read_row_states };
