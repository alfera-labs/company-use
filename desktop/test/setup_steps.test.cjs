const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup_provider } = require('../src/setup/setup_provider.js');
const { setup_steps, guided_setup_is_ready } = require('../src/setup/setup_steps.js');

const step_ids = setup_steps.map((step) => step.id);
const step = (id) => setup_steps.find((candidate) => candidate.id === id);
const rows_shown_in = (shown) => (shown.rows ?? []).filter((row) => !row.is_hidden);
const steps_after = (shown) =>
  [...rows_shown_in(shown).flatMap((row) => [row.go_to, row.link?.go_to]), shown.action?.go_to, shown.link?.go_to].filter(Boolean);

// The steps a person reaches by pressing the buttons the records hold. Work decides the way on
// at run time; where each piece of work can lead is in installer_contract.test.cjs.
function steps_reached_by_buttons(first_step_id) {
  const reached = new Set([first_step_id]);
  for (const id of reached) for (const next of steps_after(step(id))) reached.add(next);
  return [...reached];
}

test('every step has its own name, and every way out of a step leads to a step', () => {
  assert.equal(new Set(step_ids).size, step_ids.length);
  for (const shown of setup_steps) {
    if (shown.back_to) assert.ok(step_ids.includes(shown.back_to), `${shown.id} goes back to a step`);
    for (const next of [...(shown.rows ?? []).flatMap((row) => [row.go_to, row.link?.go_to]), shown.action?.go_to, shown.link?.go_to]) {
      if (next) assert.ok(step_ids.includes(next), `${shown.id} leads to a step`);
    }
  }
});

test('every button does one thing: it goes to a step, or it does work and says so while it works', () => {
  const buttons = setup_steps.flatMap((shown) => [...(shown.rows ?? []), ...(shown.action ? [shown.action] : [])]);
  for (const button of buttons) {
    assert.notEqual(Boolean(button.go_to), Boolean(button.work), button.title ?? button.label);
    if (button.work) assert.ok(button.words_while_working, button.title ?? button.label);
  }
});

test('the first step: Alfera Cloud first and filled, the own server under it, one quiet link for the rest', () => {
  const first = setup_steps[0];
  assert.deepEqual(first.rows.map((row) => row.title), ['Alfera Cloud', 'Set up my own server']);
  assert.deepEqual(first.rows.map((row) => Boolean(row.is_main_choice)), [true, false]);
  assert.equal(first.rows[0].work, 'use_alfera_cloud');
  assert.equal(first.rows[1].work, 'open_deploy_page');
  assert.deepEqual(first.rows[1].link, { label: 'I will do it myself', go_to: 'what_you_need', is_hidden: false, needs_the_installer: true });
  assert.deepEqual(first.link, { label: 'I already have an Alfera server', go_to: 'own_server' });
});

test('a person who has a server types its address on a screen of its own', () => {
  const own = step('own_server');
  assert.equal(own.action.work, 'use_own_server');
  assert.ok(own.field);
  assert.equal(own.back_to, 'where');
});

test('only the first step holds a choice: every later step is one thing, with one button at most', () => {
  for (const shown of setup_steps.slice(1)) {
    assert.equal(shown.rows, undefined, shown.id);
    assert.ok(!(shown.field && !shown.action), `${shown.id}: a field has a button`);
  }
});

test('the guided setup goes screen by screen, in order, to the step that needs the server', () => {
  assert.equal(guided_setup_is_ready, true);
  assert.deepEqual(steps_reached_by_buttons('where'), [
    'where',
    'what_you_need',
    'own_server',
    'make_server',
    'create_server',
    'server_address',
  ]);
  assert.equal(step('make_server').action.work, 'make_server');
  assert.equal(step('server_address').action.work, 'check_server');
  assert.equal(step('api_key').action.work, 'start_install');
  assert.equal(step('setting_up').starts_with, 'wait_for_install');
  assert.equal(step('signing_in').starts_with, 'open_my_server');
});

test('every screen has a way back or a way out', () => {
  for (const shown of setup_steps.slice(1)) {
    const ways = [shown.back_to, ...(shown.ways_out_when_stopped ?? []).map((way) => way.go_to)].filter(Boolean);
    assert.ok(ways.length > 0, `${shown.id} has a way back or out`);
    for (const way of ways) assert.ok(step_ids.includes(way), `${shown.id} leads to a step`);
  }
  for (const id of ['own_server', 'sign_in_link', 'what_you_need', 'make_server', 'make_bigger_server', 'create_server', 'create_bigger_server', 'server_address', 'api_key']) assert.ok(step(id).back_to, id);
});

test('a screen that waits for the server has no Back while it works; when it stopped, it goes to the address or to the first screen', () => {
  for (const id of ['setting_up', 'signing_in', 'signing_in_on_a_shared_name']) {
    assert.equal(step(id).back_to, undefined, id);
    assert.deepEqual(step(id).ways_out_when_stopped, [
      { label: 'Back', go_to: 'server_address' },
      { label: 'Start over', go_to: 'where' },
    ]);
  }
});

test('the first screen is the way out of everything: it has Alfera Cloud and the server a person already has', () => {
  const first = step('where');
  assert.equal(first.rows[0].work, 'use_alfera_cloud');
  assert.equal(first.link.go_to, 'own_server');
  assert.equal(first.back_to, undefined);
});

test('the deploy page needs no installer; the guided setup by hand is offered only when its installer answers', () => {
  const [cloud, own] = step('where').rows;
  assert.equal(own.needs_the_installer, undefined);
  assert.equal(own.link.needs_the_installer, true);
  assert.equal(cloud.link, undefined);
});

test('the screen that asks for a sign-in link: one field, where a link comes from, a way back, and a link from the server the app set up', () => {
  const link = step('sign_in_link');
  assert.equal(link.title, 'Paste your sign-in link');
  assert.equal(link.field.name, 'Paste your sign-in link');
  assert.equal(link.lead, 'The owner or an admin of your Alfera makes a sign-in link for you. If you run the server yourself, run ./alfera team link on that machine.');
  assert.equal(link.back_to, 'where');
  assert.deepEqual(link.action, { label: 'Sign in', work: 'open_sign_in_link', words_while_working: 'Signing in…' });
  assert.deepEqual(link.other_action, {
    label: 'Get a new sign-in link from my server',
    work: 'get_sign_in_link_from_my_server',
    words_while_working: 'Asking your server…',
    shown_when: 'app_set_up_this_server',
  });
  assert.equal(setup_steps.filter((shown) => shown.other_action).length, 1);
});

test('the screen for a shared name is the done screen with one quiet line, and no button', () => {
  const shared = step('signing_in_on_a_shared_name');
  assert.equal(shared.title, step('signing_in').title);
  assert.equal(shared.note, 'This address is fine for trying Alfera out. For real use, point a domain name of your own at the server.');
  assert.equal(shared.action, undefined);
  assert.equal(shared.rows, undefined);
  assert.equal(step('signing_in').note, undefined);
});

// One name for one thing, in every sentence a person reads: "API key" for the key of Anthropic
// or OpenAI, "SSH key" for the key of this app. No name of a company the person never chose,
// no file they cannot open from here, no "ask for help" with nobody to ask.
test('the words of the setup: one name for each thing, and nothing a person cannot act on', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const files = ['setup_steps.js', 'setup_provider.js', 'installer_contract.cjs', 'server_setup.cjs', 'setup_screen.cjs', 'address_choice.cjs'];
  const words_never_said = [/\bAI key\b/, /WorkOS/, /SELF_HOSTING/, /ask for help/, /model provider/, /this browser/, /from the Alfera menu/, /\b(?<!API )(?<!SSH )(?<!SSH Key" and paste the SSH )key\b(?! pair)/i];
  for (const file of files) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'setup', file), 'utf8');
    const sentences = text.split('\n').filter((line) => !/^\s*\/\//.test(line)).flatMap((line) => line.match(/'[^']*[a-z] [a-z][^']*'|`[^`]* [^`]*`/g) ?? []);
    for (const said of sentences) for (const words of words_never_said) assert.doesNotMatch(said, words, `${file}: ${said}`);
  }
});

test('the API key is typed into a field that hides it', () => {
  assert.equal(step('api_key').field.is_secret, true);
});

test('the record of the hosting company names what to pick and where the key goes', () => {
  for (const name of ['name', 'price_words', 'image_to_pick', 'size_to_pick', 'bigger_size_to_pick', 'bigger_price_words', 'field_for_the_key']) {
    assert.equal(typeof setup_provider[name], 'string', name);
  }
  const steps = step('create_server').list.join(' ');
  for (const words of [setup_provider.image_to_pick, setup_provider.size_to_pick, setup_provider.field_for_the_key]) {
    assert.ok(steps.includes(words), words);
  }
  assert.equal(step('create_server').list.length, setup_provider.steps.length);
});

test('the screen for a bigger server names the bigger size and its price in one sentence, and in its steps', () => {
  const bigger = step('create_bigger_server');
  assert.equal(bigger.lead, 'The first server had too little memory. Make one with 8 GB of memory, which costs 48 dollars a month.');
  const steps = bigger.list.join(' ');
  assert.ok(steps.includes('8 GB of memory'));
  assert.ok(!steps.includes('4 GB of memory'));
  assert.ok(!steps.includes('{size}'));
  assert.deepEqual(bigger.action, step('create_server').action);
  assert.equal(bigger.starts_with, 'make_key_pair');
});

test('the app makes the server itself; making it by hand is the quiet way next to it', () => {
  for (const [id, made_by_hand] of [['make_server', 'create_server'], ['make_bigger_server', 'create_bigger_server']]) {
    assert.equal(step(id).link.go_to, made_by_hand, id);
    assert.equal(step(made_by_hand).back_to, id, made_by_hand);
    assert.deepEqual(step(id).stop_while_working, { label: 'Stop', work: 'stop_making_server' }, id);
  }
  assert.equal(step('make_bigger_server').action.work, 'make_bigger_server');
  assert.ok(step('make_bigger_server').lead.includes('8 GB of memory, which costs 48 dollars a month'));
  assert.ok(step('make_bigger_server').note.startsWith('Delete the first server'));
  assert.equal(setup_provider.size_id, 's-2vcpu-4gb');
  assert.equal(setup_provider.bigger_size_id, 's-4vcpu-8gb');
});
