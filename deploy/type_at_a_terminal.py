#!/usr/bin/env python3
"""Runs a command at a terminal of its own and types the answers, for the tests of install.sh
and of the helper. A question that is asked on /dev/tty can be tested in no other way.

Usage: type_at_a_terminal.py <file for what the terminal showed> <step>... -- <command>...

A step is `text to wait for=>text to type`. In the text to type, \\n is Enter and ^C is Ctrl-C.
A step with nothing after `=>` only waits. Each text is looked for after the one before it, so
a question that comes twice is two steps.

Exit status: the one of the command. 97 when a text did not come in time, and then the file
ends with a line that names it.
"""

import os
import pty
import select
import sys
import time

seconds_to_wait_for_a_text = 30
seconds_to_wait_for_the_end = 120
# A hidden answer is typed after the terminal stopped showing what is typed, as a person does.
seconds_before_typing = 0.2


def read_until(master, shown, found_up_to, wanted, seconds):
    """Reads what the terminal shows until `wanted` is there. Returns where it ends, or -1."""
    deadline = time.monotonic() + seconds
    while True:
        text = b"".join(shown).decode("utf-8", "replace")
        at = text.find(wanted, found_up_to) if wanted is not None else -1
        if at >= 0:
            return at + len(wanted)
        left = deadline - time.monotonic()
        if left <= 0:
            return -1
        ready, _, _ = select.select([master], [], [], left)
        if not ready:
            return -1
        try:
            chunk = os.read(master, 4096)
        except OSError:
            chunk = b""
        if not chunk:
            return -2
        shown.append(chunk)


def main():
    transcript_path = sys.argv[1]
    split_at = sys.argv.index("--")
    steps = [step.split("=>", 1) for step in sys.argv[2:split_at]]
    command = sys.argv[split_at + 1 :]

    child, master = pty.fork()
    if child == 0:
        os.execvp(command[0], command)

    shown = []
    found_up_to = 0
    missing = None
    for wanted, typed in steps:
        found_up_to = read_until(master, shown, found_up_to, wanted, seconds_to_wait_for_a_text)
        if found_up_to < 0:
            missing = wanted
            break
        if typed:
            time.sleep(seconds_before_typing)
            os.write(master, typed.replace("\\n", "\n").replace("^C", "\x03").encode())
    if missing is None:
        read_until(master, shown, 0, None, seconds_to_wait_for_the_end)
    else:
        try:
            os.kill(child, 9)
        except ProcessLookupError:
            pass

    _, status = os.waitpid(child, 0)
    text = b"".join(shown).decode("utf-8", "replace").replace("\r", "")
    if missing is not None:
        text += f"\nTHE TERMINAL NEVER SHOWED: {missing}\n"
    with open(transcript_path, "w") as transcript:
        transcript.write(text)
    if missing is not None:
        sys.exit(97)
    sys.exit(os.waitstatus_to_exitcode(status) if status >= 0 else 1)


if __name__ == "__main__":
    main()
