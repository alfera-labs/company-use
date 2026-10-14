const assert = require('node:assert/strict');
const { test } = require('node:test');
const { one_line_of, plain_text_of } = require('../src/setup/plain_text.cjs');

test('codes that colour a terminal or move its cursor are taken out', () => {
  assert.equal(plain_text_of('\x1b[1;31mred\x1b[0m and \x1b[2K\x1b[1Aplain'), 'red and plain');
  assert.equal(plain_text_of('\x1b]0;a window title\x07words'), 'words');
  assert.equal(plain_text_of('\x1b]8;;https://example.com\x1b\\a link\x1b]8;;\x1b\\'), 'a link');
  assert.equal(plain_text_of('\x1bcwords\x1b7\x1b8\x1b(B'), 'words');
});

test('bytes that are not text are taken out, and lines and tabs stay', () => {
  assert.equal(plain_text_of('a\x00b\x07c\x08d\x7fe\x9bf'), 'abcdef');
  assert.equal(plain_text_of('one\n\ttwo\r\nthree'), 'one\n\ttwo\nthree');
});

test('a line a terminal would have written over stays, on a line of its own', () => {
  assert.equal(plain_text_of('10%\r50%\r100%'), '10%\n50%\n100%');
});

test('a tag stays what it is, text: nothing here makes HTML, and nothing reads it as HTML', () => {
  assert.equal(plain_text_of('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
});

test('the sentence of a failure is one line', () => {
  assert.equal(one_line_of('\x1b[31mAlfera did not start.\x1b[0m\n  Try again.\x07'), 'Alfera did not start. Try again.');
  assert.equal(one_line_of(''), '');
});
