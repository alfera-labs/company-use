// Draws one setup step at a time from the records in setup_steps.js. It knows nothing about any
// one step: a new step is a new record, not new code here.
// The screen says what it is doing in two attributes, for a person's eyes through the styles
// and for a script that checks the setup: data-step, and data-state (idle, working, done, failed).
const steps_by_id = Object.fromEntries(setup_steps.map((step) => [step.id, step]));
const screen = document.querySelector('main');
const words_for_a_failure_with_no_sentence = 'That did not work. Try again.';
const milliseconds_a_success_stays_on_screen = 700;
const milliseconds_a_step_takes_to_leave = 130;
const the_alfera_mark = 'M512 120 408 300l308 536h204zM290 507l205 1-188 328H103z';
const wants_no_motion = matchMedia('(prefers-reduced-motion: reduce)');
let clock = null;
let last_progress = null;
// What the app knows that a step can depend on: the address in use, whether the installer
// answers, and whether this app set up the server at that address.
let facts = {};
// Counts the screens drawn. Work belongs to the screen that started it.
let screens_drawn = 0;

function create(tag, class_name, text) {
  const element = document.createElement(tag);
  if (class_name) element.className = class_name;
  if (text) element.textContent = text;
  return element;
}

const set_state = (state) => (screen.dataset.state = state);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function set_every_button_waiting(is_waiting) {
  for (const button of screen.querySelectorAll('button')) button.disabled = is_waiting;
}

function create_mark() {
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark.setAttribute('viewBox', '0 0 1024 1024');
  mark.setAttribute('class', 'mark');
  mark.setAttribute('aria-hidden', 'true');
  const shapes = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shapes.setAttribute('d', the_alfera_mark);
  mark.append(shapes);
  return mark;
}

function create_field(field, text) {
  const input = create('input');
  Object.assign(input, { type: field.is_secret ? 'password' : 'text', value: text });
  Object.assign(input, { placeholder: field.example, ariaLabel: field.name });
  Object.assign(input, { spellcheck: false, autocomplete: 'off' });
  return input;
}

function create_form(input_or_words, button, on_submit) {
  const form = create('form', 'row');
  form.append(input_or_words, button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    on_submit();
  });
  return form;
}

// The answer of work goes to the screen that started it. When the person has gone to another
// screen in the meantime, the answer goes nowhere: it never lands on a screen it is not about.
function run_work(work, input) {
  const screen_of_this_work = screens_drawn;
  return window.alfera_setup
    .run(work, input)
    .catch(() => ({ problem: words_for_a_failure_with_no_sentence }))
    .then((outcome) => (screen_of_this_work === screens_drawn ? outcome : new Promise(() => {})));
}

// A choice row: words on the left, its own button on the right, its own sentence under it.
function create_row(row) {
  const section = create('section');
  const words = create('div');
  words.append(create('h2', '', row.title), create('p', '', row.detail));
  const button = create('button', row.is_main_choice ? 'main_choice' : '', row.action);
  const problem = create('p', 'problem');
  problem.setAttribute('role', 'alert');
  const form = create_form(words, button, async () => {
    if (row.go_to) return show_step(row.go_to);
    problem.textContent = '';
    set_every_button_waiting(true);
    set_state('working');
    button.textContent = row.words_while_working;
    const outcome = await run_work(row.work, '');
    if (outcome.problem) button.textContent = row.action;
    show_outcome(outcome, problem);
  });
  section.append(form, problem);
  if (shows_link(row.link)) section.append(create_quiet_button('quiet', row.link.label, () => show_step(row.link.go_to)));
  return section;
}

const shows_link = (link) => Boolean(link) && !link.is_hidden && (!link.needs_the_installer || facts.installer_is_available);

function create_list(step) {
  const list = create(step.list_is_numbered ? 'ol' : 'ul', 'lines');
  list.append(...step.list.map((line) => create('li', '', line)));
  return list;
}

function create_copied_text(copied_text) {
  const block = create('div', 'copied_text');
  const copy = create('button', '', copied_text.action);
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    await window.alfera_setup.copy(copied_text.name);
    copy.textContent = 'Copied';
  });
  block.append(create('code'), copy);
  return block;
}

function create_quiet_button(class_name, label, on_press) {
  const button = create('button', class_name, label);
  button.type = 'button';
  button.addEventListener('click', on_press);
  return button;
}

// The one button of a failure: it goes to a step, or does work that answers with the next one.
function create_button_after_failure(action, problem) {
  const button = create('button', 'main_choice', action.label);
  button.type = 'button';
  button.addEventListener('click', async () => {
    if (action.go_to) return show_step(action.go_to);
    set_every_button_waiting(true);
    set_state('working');
    show_outcome(await run_work(action.work, ''), problem);
  });
  return button;
}

// One more button on a step, for work the app can do only in some cases.
function create_other_action(action, problem) {
  const button = create_quiet_button('other_action', action.label, async () => {
    problem.textContent = '';
    screen.querySelector('.after_failure').replaceChildren();
    set_every_button_waiting(true);
    set_state('working');
    button.textContent = action.words_while_working;
    const outcome = await run_work(action.work, '');
    button.textContent = action.label;
    show_outcome(outcome, problem);
  });
  return button;
}

function create_log_link() {
  const link = create_quiet_button('quiet', 'Copy the log', async () => {
    await window.alfera_setup.copy('log');
    link.textContent = 'The log is copied';
  });
  return link;
}

// What a piece of work answered: the next step, a text to show, the end of the setup, or one
// sentence with at most one button.
function show_outcome(outcome, problem) {
  if (outcome.go_to) return show_step(outcome.go_to, { problem: outcome.problem });
  if (outcome.text) screen.querySelector('.copied_text code').textContent = outcome.text;
  // Work that is done with nothing more to show has finished the setup. The buttons stay as
  // they are, waiting, until the app takes the place of this screen.
  if (!outcome.problem && !outcome.text) return set_state('done');
  set_every_button_waiting(false);
  if (!outcome.problem) return set_state('idle');
  clearInterval(clock);
  set_state('failed');
  problem.textContent = outcome.problem;
  const after = screen.querySelector('.after_failure');
  const ways_out = steps_by_id[screen.dataset.step].ways_out_when_stopped ?? [];
  after.replaceChildren(
    ...(outcome.action ? [create_button_after_failure(outcome.action, problem)] : []),
    ...(outcome.has_log ? [create_log_link()] : []),
    ...ways_out.map((way) => create_quiet_button('quiet', way.label, () => show_step(way.go_to))),
  );
  after.scrollIntoView({ block: 'nearest' });
  (after.querySelector('.main_choice') ?? screen.querySelector('input'))?.focus();
}

function create_stop_button(stop) {
  return create_quiet_button('quiet stop', stop.label, () => window.alfera_setup.run(stop.work, ''));
}

async function act_on_step(step, input, button, problem) {
  if (step.action.go_to) return show_step(step.action.go_to);
  problem.textContent = '';
  set_every_button_waiting(true);
  set_state('working');
  const stop = step.stop_while_working ? create_stop_button(step.stop_while_working) : null;
  if (stop) problem.before(stop);
  button.textContent = step.action.words_while_working;
  const outcome = await run_work(step.action.work, input?.value ?? '');
  stop?.remove();
  if (outcome.go_to && !outcome.problem && step.action.words_when_done) {
    set_state('done');
    button.textContent = step.action.words_when_done;
    await wait(milliseconds_a_success_stays_on_screen);
  }
  if (outcome.go_to || outcome.problem) button.textContent = step.action.label;
  show_outcome(outcome, problem);
}

function draw_step(step, { field_text = '', problem: sentence = '' }) {
  clearInterval(clock);
  screens_drawn += 1;
  screen.dataset.step = step.id;
  set_state(sentence ? 'failed' : 'idle');
  const input = step.field ? create_field(step.field, field_text) : null;
  const button = step.action ? create('button', 'main_choice', step.action.label) : null;
  const problem = create('p', 'problem', sentence);
  problem.setAttribute('role', 'alert');
  const act = () => act_on_step(step, input, button, problem);
  screen.replaceChildren(
    ...(step.back_to ? [create_quiet_button('back', 'Back', () => show_step(step.back_to))] : []),
    ...(step.shows_mark ? [create_mark()] : []),
    create('h1', '', step.title),
    create('p', 'lead', step.lead),
    ...(step.note ? [create('p', 'note', step.note)] : []),
    ...(step.copied_text ? [create_copied_text(step.copied_text)] : []),
    ...(step.list ? [create_list(step)] : []),
    ...(step.rows ?? []).filter((row) => !row.is_hidden).map(create_row),
    ...(step.shows_progress ? [create('ol', 'progress'), create('p', 'timing')] : []),
    ...(button ? [create_form(input ?? create('span'), button, act)] : []),
    problem,
    create('div', 'after_failure'),
    ...(facts[step.other_action?.shown_when] ? [create_other_action(step.other_action, problem)] : []),
    ...(step.link ? [create_quiet_button('quiet link', step.link.label, () => show_step(step.link.go_to))] : []),
  );
  // A new screen starts at its top. Putting the pointer in the field must not scroll it away.
  scrollTo(0, 0);
  (screen.querySelector('input') ?? screen.querySelector('button.main_choice'))?.focus({ preventScroll: true });
  if (step.shows_progress && last_progress) show_progress(last_progress);
  if (!step.starts_with) return;
  set_state('working');
  run_work(step.starts_with, '').then((outcome) => show_outcome(outcome, problem));
}

// One step leaves, the next one arrives: a short fade, on the colour of the page, so nothing
// flashes. A person who asked their Mac for less motion gets the next step at once.
let is_first_step = true;
async function show_step(step_id, options = {}) {
  if (!is_first_step && !wants_no_motion.matches) {
    screen.classList.add('leaving');
    await wait(milliseconds_a_step_takes_to_leave);
  }
  is_first_step = false;
  draw_step(steps_by_id[step_id], options);
  screen.classList.remove('leaving', 'arriving');
  void screen.offsetWidth;
  screen.classList.add('arriving');
}

const two_digits = (number) => String(number).padStart(2, '0');

// The rows of the installer, and how long it has run. The time is counted from when the run
// started on the Mac, so it is the same after the window is drawn again.
function show_progress(progress) {
  last_progress = progress;
  const { rows, started_at, usual_time } = progress;
  const list = screen.querySelector('.progress');
  if (!list) return;
  list.replaceChildren(
    ...rows.map((row) => {
      const line = create('li', '', row.title);
      line.dataset.state = row.state;
      return line;
    }),
  );
  const show_time = () => {
    const seconds = Math.max(0, Math.round((Date.now() - started_at) / 1000));
    const so_far = `${Math.floor(seconds / 60)}:${two_digits(seconds % 60)}`;
    screen.querySelector('.timing').textContent = `It usually takes ${usual_time}. So far: ${so_far}.`;
  };
  clearInterval(clock);
  show_time();
  if (screen.dataset.state === 'working') clock = setInterval(show_time, 1000);
}

function press_stop_or_go_one_step_back_on_escape(event) {
  if (event.key !== 'Escape') return;
  if (screen.dataset.state === 'working') return screen.querySelector('.stop')?.click();
  const step = steps_by_id[screen.dataset.step];
  const way_out = screen.dataset.state === 'failed' ? step?.ways_out_when_stopped?.[0].go_to : null;
  if (step?.back_to ?? way_out) show_step(step.back_to ?? way_out);
  else if (step?.id === 'where') window.alfera_setup.leave();
}

document.addEventListener('keydown', press_stop_or_go_one_step_back_on_escape);

// The app says which screen to show: the first one when the setup opens, and another one later,
// for example when the person chooses "Change Address…" while the setup is open.
async function show_screen_the_app_asks_for(wanted) {
  facts = await window.alfera_setup.read();
  show_step((wanted ?? facts.first_screen).step, wanted ?? facts.first_screen);
}

window.alfera_setup.on_progress(show_progress);
window.alfera_setup.on_show(show_screen_the_app_asks_for);
show_screen_the_app_asks_for(null);
