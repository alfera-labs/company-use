export function normalize_email_subject(subject: string): string {
  return subject
    .replace(/^\s*((re|fwd?|aw|sv|vs)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// RFC 5322 caps a header line at 998 characters. Inbound subjects are attacker-writable and
// carry forward into every reply, so a long one would make the provider reject the send — and a
// rejected reply reaches the person as the runtime's "couldn't compose a reply" notice instead
// of the answer. Truncating loses a few words; not truncating loses the whole message.
const reply_subject_character_limit = 900;

export function build_reply_subject(subject: string): string {
  const reply_subject = /^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
  return reply_subject.length <= reply_subject_character_limit
    ? reply_subject
    : `${reply_subject.slice(0, reply_subject_character_limit - 1)}…`;
}
