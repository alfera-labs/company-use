// The setup screens, as data. One record is one step, and one step is one screen with one
// thing to do. setup_page.js draws these records. This file runs in the page and in the tests.
//
// A step can hold:
//   shows_mark    the Alfera mark above the title
//   rows          choices, each with its own button (only the first step has a choice)
//   link          one quiet link under everything, to another step
//   list          plain lines, numbered when list_is_numbered
//   copied_text   a text the person copies; the work named in starts_with brings it
//   field         one field
//   action        the one filled button: it goes to a step (go_to) or does work (work)
//   other_action  one more button that does work, shown only when the fact named in
//                 shown_when holds
//   shows_progress  the rows of the installer, with a state each
//   note          one quiet line under the lead
//   starts_with   work that starts when the step shows
//   back_to       the step "Back" and the Escape key go to
//   ways_out_when_stopped  for a step that has no "Back" while it works: where the person can
//                 go when the work stopped. The first one is where the Escape key goes.
// A row can hold one quiet link of its own. A link with needs_the_installer shows only when the
// installer answers.
// Work is named here and done in work_by_name in setup_screen.cjs. It answers with the next
// step, or with one sentence and, at most, one button.
// Every step has a way back or a way out. test/setup_steps.test.cjs holds that.
const provider = typeof setup_provider === 'undefined' ? require('./setup_provider.js').setup_provider : setup_provider;

const provider_steps_with = (size) => provider.steps.map((step) => step.replace('{size}', size));

// False hides the guided setup: its row does not show, so none of its steps can be reached.
const guided_setup_is_ready = true;

// The server works on while the screen waits, so these two steps have no "Back" while they
// work. When the work stopped, the person can go to the address, or to the first screen.
const ways_out_when_stopped = [
  { label: 'Back', go_to: 'server_address' },
  { label: 'Start over', go_to: 'where' },
];

const setup_steps = [
  {
    id: 'where',
    shows_mark: true,
    title: 'Where is your Alfera?',
    lead: 'You can change this later: in the menu bar, choose Alfera, then "Change Address…".',
    rows: [
      {
        title: 'Alfera Cloud',
        detail: 'Nothing to set up. Sign in and start.',
        action: 'Use Alfera Cloud',
        is_main_choice: true,
        work: 'use_alfera_cloud',
        words_while_working: 'Opening…',
      },
      {
        title: 'Set up my own server',
        detail: 'Alfera runs on a server you rent from DigitalOcean or AWS. It takes about 10 minutes.',
        action: 'Set it up',
        work: 'open_deploy_page',
        words_while_working: 'Opening…',
        link: { label: 'I will do it myself', go_to: 'what_you_need', is_hidden: !guided_setup_is_ready, needs_the_installer: true },
      },
    ],
    link: { label: 'I already have an Alfera server', go_to: 'own_server' },
  },
  {
    id: 'own_server',
    back_to: 'where',
    title: 'Your Alfera server',
    lead: 'Paste its address, or the sign-in link you were given.',
    field: { name: 'Address of your server', example: 'https://alfera.example.com' },
    action: { label: 'Open', work: 'use_own_server', words_while_working: 'Checking…' },
  },
  // The app shows this one by itself, over a server that asks for a sign-in link.
  {
    id: 'sign_in_link',
    back_to: 'where',
    title: 'Paste your sign-in link',
    lead: 'The owner or an admin of your Alfera makes a sign-in link for you. If you run the server yourself, run ./alfera team link on that machine.',
    field: { name: 'Paste your sign-in link', example: 'https://alfera.example.com/join/…' },
    action: { label: 'Sign in', work: 'open_sign_in_link', words_while_working: 'Signing in…' },
    other_action: {
      label: 'Get a new sign-in link from my server',
      work: 'get_sign_in_link_from_my_server',
      words_while_working: 'Asking your server…',
      shown_when: 'app_set_up_this_server',
    },
  },
  {
    id: 'what_you_need',
    back_to: 'where',
    title: 'What you need',
    lead: 'Two things. Get both before you start.',
    list: [
      `An account at ${provider.name}. The app makes a server there for you. It costs about ${provider.price_words}.`,
      'An API key. Alfera thinks with it. You get one from Anthropic or OpenAI, and you pay them for what Alfera uses.',
    ],
    action: { label: 'Continue', go_to: 'make_server' },
  },
  {
    id: 'make_server',
    back_to: 'what_you_need',
    title: 'Make your server',
    lead: `The app makes the server in your ${provider.name} account. Press the button, sign in, then press "Authorize".`,
    note: 'The app gives the access back as soon as the server is made.',
    action: {
      label: 'Make my server',
      work: 'make_server',
      words_while_working: `Waiting for ${provider.name}…`,
      words_when_done: 'Server made',
    },
    stop_while_working: { label: 'Stop', work: 'stop_making_server' },
    link: { label: 'I will make the server myself', go_to: 'create_server' },
  },
  {
    id: 'make_bigger_server',
    back_to: 'what_you_need',
    title: 'Make a bigger server',
    lead: `The first server had too little memory. The app makes one with ${provider.bigger_size_to_pick}, which costs ${provider.bigger_price_words}.`,
    note: `Delete the first server on ${provider.name}, so you do not pay for it.`,
    action: {
      label: 'Make a bigger server',
      work: 'make_bigger_server',
      words_while_working: `Waiting for ${provider.name}…`,
      words_when_done: 'Server made',
    },
    stop_while_working: { label: 'Stop', work: 'stop_making_server' },
    link: { label: 'I will make the server myself', go_to: 'create_bigger_server' },
  },
  {
    id: 'create_server',
    back_to: 'make_server',
    title: 'Create your server',
    lead: 'The server needs the SSH key of this app to let it in. Copy the SSH key, then follow the steps.',
    starts_with: 'make_key_pair',
    copied_text: { name: 'public_key', action: 'Copy the SSH key' },
    list: provider_steps_with(provider.size_to_pick),
    list_is_numbered: true,
    action: { label: 'I created the server', go_to: 'server_address' },
  },
  // The same screen, for the second server after the first one was too small to build Alfera.
  {
    id: 'create_bigger_server',
    back_to: 'make_bigger_server',
    title: 'Create a bigger server',
    lead: `The first server had too little memory. Make one with ${provider.bigger_size_to_pick}, which costs ${provider.bigger_price_words}.`,
    starts_with: 'make_key_pair',
    copied_text: { name: 'public_key', action: 'Copy the SSH key' },
    list: provider_steps_with(provider.bigger_size_to_pick),
    list_is_numbered: true,
    action: { label: 'I created the server', go_to: 'server_address' },
  },
  {
    id: 'server_address',
    back_to: 'create_server',
    title: 'The address of your server',
    lead: `${provider.name} shows it on the page of your new server. It is four numbers with dots between them. A domain name that points at the server works too.`,
    field: { name: 'Address of your server', example: '203.0.113.7' },
    action: {
      label: 'Continue',
      work: 'check_server',
      words_while_working: 'Connecting…',
      words_when_done: 'Connected',
    },
  },
  {
    id: 'api_key',
    back_to: 'server_address',
    title: 'Your API key',
    lead: 'Paste your API key from Anthropic or OpenAI. It goes to your server. This Mac does not keep it.',
    field: { name: 'Your API key', example: 'sk-…', is_secret: true },
    action: { label: 'Set up my server', work: 'start_install', words_while_working: 'Starting…' },
  },
  {
    id: 'setting_up',
    title: 'Setting up your server',
    lead: 'Leave this window open. There is nothing else for you to do.',
    shows_progress: true,
    starts_with: 'wait_for_install',
    ways_out_when_stopped,
  },
  {
    id: 'signing_in',
    title: 'Your server is ready',
    lead: 'Signing you in to it now.',
    starts_with: 'open_my_server',
    ways_out_when_stopped,
  },
  // The same screen, for a server that got its name from its numbers and not from a domain.
  {
    id: 'signing_in_on_a_shared_name',
    title: 'Your server is ready',
    lead: 'Signing you in to it now.',
    note: 'This address is fine for trying Alfera out. For real use, point a domain name of your own at the server.',
    starts_with: 'open_my_server_after_the_note',
    ways_out_when_stopped,
  },
];

if (typeof module !== 'undefined') module.exports = { setup_steps, guided_setup_is_ready };
