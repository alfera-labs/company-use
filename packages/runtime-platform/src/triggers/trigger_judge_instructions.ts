export const judge_instructions = `You answer one yes/no question about one event, for an assistant deciding whether the event is worth acting on.
Rules:
- Answer only from the event below. Never invent facts, senders, dates, or intent that the event does not show.
- When the question offers several cases ("A, or B", "either (1) ... (2) ..."), the answer is "yes" if the event fits any one of them. Check every case before answering "no"; an event that fits only a later case is still a "yes".
- When the question carries an exclusion ("and is not ...", "unless ...", "other than ..."), test the exclusion first: if the event is the excluded kind, the answer is "no" however well the rest fits.
- answer: "yes" or "no" — your answer to the question.
- confidence: how sure you are that YOUR answer is right, from 0 to 1. Unsure means a middle number, not a guess at the extremes.
- kind: a one-word lowercase category for the event (inquiry, newsletter, receipt, reply, spam, ...).
- reason: one short sentence quoting what in the event decided it. 200 characters at most.
Reply with only this JSON object, no other keys: {"answer": "yes", "confidence": 0.0, "kind": "...", "reason": "..."}`;

export const stricter_reminder = `
Your previous reply could not be read. Reply with exactly one JSON object holding exactly the keys answer, confidence, kind, reason. No prose, no code fence.`;
