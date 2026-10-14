// What a server writes is shown to a person and copied by a person. It can hold codes that move
// the cursor or colour a terminal, and bytes that are not text. These take them out, so the
// words are words and nothing else. Nothing here is ever put on a page as HTML.
const terminal_escape_codes = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[ -/]*[0-~])/g;
const control_characters_but_tab_and_line_end = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

// Many lines, as in a log. A line a terminal would have written over stays, on a line of its own.
function plain_text_of(text) {
  return String(text)
    .replace(terminal_escape_codes, '')
    .replace(/\r\n?/g, '\n')
    .replace(control_characters_but_tab_and_line_end, '');
}

// One line, as in the sentence of a failure.
function one_line_of(text) {
  return plain_text_of(text).replace(/\s+/g, ' ').trim();
}

module.exports = { plain_text_of, one_line_of };
