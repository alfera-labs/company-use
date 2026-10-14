// A hidden tab costs the memory of a whole page. After a while out of sight the tab sleeps: its
// page is closed and only its address is kept, and the page loads again when the tab is shown.
// ALFERA_TAB_SLEEP_MINUTES changes how long "a while" is, for a scripted check or a small Mac.
const minutes_hidden_before_sleep = Number(process.env.ALFERA_TAB_SLEEP_MINUTES ?? 15);
const sleep_check_every_ms = Math.min(60_000, minutes_hidden_before_sleep * 30_000);

const states_of_a_run_under_way = ['working', 'needs_you'];

function may_tab_sleep({ is_in_front, is_loading, hidden_for_ms, session_state }) {
  if (is_in_front || is_loading) return false;
  if (states_of_a_run_under_way.includes(session_state)) return false;
  return hidden_for_ms >= minutes_hidden_before_sleep * 60_000;
}

// Runs inside the page. True while an answer is still arriving, and while a field the person
// can see and type in holds text: closing the page would lose it. A field the page keeps for
// itself, hidden from the person, does not count: every Alfera page has some, and they always
// hold a value. The stop button is found by the label it has for screen readers, so a change of
// class names in the web app does not break this.
function page_is_in_use() {
  const types_without_typed_text = ['hidden', 'checkbox', 'radio', 'submit', 'button'];
  const fields = document.querySelectorAll(
    'textarea, input, [contenteditable]:not([contenteditable="false"])',
  );
  const is_for_the_person = (field) =>
    field.getAttribute('aria-hidden') !== 'true' &&
    !field.disabled &&
    !field.readOnly &&
    field.getClientRects().length > 0;
  const holds_typed_text = [...fields].some(
    (field) =>
      !types_without_typed_text.includes(field.type) &&
      is_for_the_person(field) &&
      (field.value ?? field.textContent ?? '').trim() !== '',
  );
  return holds_typed_text || Boolean(document.querySelector('[aria-label="Stop response"]'));
}

const page_is_in_use_script = `(${page_is_in_use})()`;

module.exports = { may_tab_sleep, page_is_in_use, page_is_in_use_script, sleep_check_every_ms };
