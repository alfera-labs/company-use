import type { TemplateListing } from '@coworker/shared';

/**
 * The same listing as clean markdown, served at /templates/{slug}.md for crawlers that would
 * otherwise read our HTML. One renderer, one read model — the markdown can never drift from the
 * page because both are built from the same object.
 */
export function render_template_listing_markdown(listing: TemplateListing): string {
  const sections = [
    `# ${listing.name}`,
    listing.summary,
    listing.outcome ? `**What you get:** ${listing.outcome}` : '',
    `- Kind: ${listing.kind}`,
    `- Availability: ${listing.listing_state === 'ready' ? 'ready to switch on yourself' : 'built with you'}`,
    `- Published by: ${listing.publisher.display_name}`,
    render_list(
      listing.kind === 'skill' ? '## What this changes' : '## What you get',
      listing.what_you_get,
    ),
    render_list('## What it does', listing.what_it_does),
    render_guidance(listing),
    render_when(listing),
    render_list(
      '## Apps',
      listing.apps.map((app) => `${app.label}${app.is_optional ? ' (optional)' : ''} — ${app.why}`),
    ),
    render_list(
      '## Access',
      listing.access.map((line) => `${line.label} (${line.risk_label.toLowerCase()})`),
    ),
    render_list(
      '## You will choose',
      listing.setup_questions.map((question) => question.label),
    ),
    render_inside(listing),
    listing.caveat ? `## Worth knowing\n\n${listing.caveat}` : '',
  ];
  return `${sections.filter(Boolean).join('\n\n')}\n`;
}

function render_when(listing: TemplateListing) {
  if (listing.used_when) {
    const phrases = listing.used_when.discovery_phrases;
    return [
      '## When it gets used',
      '',
      listing.used_when.note,
      ...(phrases.length > 0 ? ['', `Phrases it watches for: ${phrases.join(', ')}.`] : []),
    ].join('\n');
  }
  return render_list(
    '## When it runs',
    listing.starts_when.map((block) => [block.title, block.note].filter(Boolean).join(' — ')),
  );
}

function render_guidance(listing: TemplateListing) {
  return render_list(
    '## The guidance',
    listing.guidance.map((line) => `**${line.label}** — ${line.value}`),
  );
}

function render_inside(listing: TemplateListing) {
  const { whats_inside } = listing;
  const files = whats_inside.tree.map((entry) => `${entry.file_path} — ${entry.note}`);
  return [
    "## What's inside",
    '',
    `${whats_inside.file_count} files, ${whats_inside.total_bytes} bytes. It does not run a shell when it loads.`,
    '',
    ...files.map((line) => `- ${line}`),
  ].join('\n');
}

function render_list(heading: string, items: string[]) {
  if (items.length === 0) return '';
  return [heading, '', ...items.map((item) => `- ${item}`)].join('\n');
}
