import { sandbox_document_workflow } from '@runtime-platform/skills/library/shared/office_document_workflow';
import type { SkillDefinition } from '@runtime-platform/skills/types';

const guidance = `# Presentations (.pptx, Google Slides)

Create, edit, and verify PowerPoint decks in the sandbox with python-pptx and
Pillow. A deck is a visual artifact: you verify it by rendering the slides to
images and LOOKING at them with workspace-view_image. Printed checks are the
floor; your eyes are the verification.

## Narrative first

A deck is an argument, not a container. Before any code, answer three things:
who the audience is and what they already know; what the deck must do
(inform, teach, persuade, recommend, decide); and the communication job in
one sentence: "By the end, this audience should X because Y." Every slide
either serves that sentence or gets cut.

- Pick a narrative arc that fits the job (context, stakes, evidence,
  implications, action; or problem, causes, options, recommendation; or
  question, analysis, answer) and order the slides so each one creates the
  need for the next.
- One claim per slide, and the title IS the claim. "Churn concentrates in
  month two" is a title; "Churn analysis" is a topic. Someone reading only
  the titles should get the whole argument.
- Turn evidence into meaning: what they see, what it means, why it matters
  for the decision. A slide that inventories facts without a point is a
  spreadsheet, not a slide.
- Open and close deliberately. The title slide is minimal and sets the tone;
  the final slide lands the takeaway or the ask (the closing rule under Design
  it for THIS deck).
- Write natural, audience-facing copy: no planning notes or talk tracks on
  slides, no formula repeated across titles ("From X to Y" on every slide),
  varied sentence structure. Low density, high value — one strong sentence
  usually beats three bullets.
- Cover everything the user asked for as one coherent story, not a pile of
  facts. A named requirement ("a picture for each place") is a delivery
  gate, not a nice-to-have.

## Design it for THIS deck

There is no house template. Decide the look per deck, the way a designer
would:

- Start from purpose, audience, and subject. An investor pitch, a quarterly
  data report, a travel deck, and a wedding program should not look alike:
  working decks are quiet, dense, and scannable; editorial or celebratory
  decks can be photographic and expressive.
- Choose one visual system and hold it for the whole deck: one canvas (16:9 —
  set prs.slide_width and prs.slide_height before adding slides), a small
  type scale with a real jump between roles, one palette from the subject
  with one deliberate accent, one grid (The layout engine, below).
- Type floors when no template dictates otherwise (floors, not a scale — go
  bigger when the design wants it): deck title at least 50pt, slide titles
  35pt, subheads and callouts 24pt, body 16pt. When text does not fit, cut
  words before shrinking type, and never let a one-line title wrap to two.
- Match imagery to the subject. When the deck is about a real thing — a
  place, a product, a person — show genuine images of that actual thing. A
  slide captioned with a name must show that thing; if nothing good exists,
  use an honest wider image and caption it truthfully. Never mislabel.
- When editing a template or an existing deck, its system wins: match fonts,
  sizes, palette, spacing, and placeholders; edit inherited slides instead of
  rebuilding.
- Then render, look, and refine (below). Judge the render like a viewer:
  hierarchy visible at thumbnail size, nothing stretched, nothing colliding,
  text readable over whatever sits behind it.
- The closing slide is a designed slide, not a leftovers bin. Build it from one
  of the deck's defined layouts — usually the statement or full-bleed layout —
  and land the takeaway or the ask in one line. If the remaining content does
  not fit the deck's layouts, cut content; never improvise a one-off layout for
  the last slide. No generic "Thank you" slide: gratitude is not a takeaway.
- The first and last slides are what the audience remembers. Give the close the
  same design attention as the title.

## The layout engine

Never use the built-in template placeholders. python-pptx's default Title
Slide, Title and Content, and Two Content layouts drop text into placeholders
positioned for an old corporate template — a subtitle stranded at the far-left
edge, everything in the fallback font — and a deck built on them reads
unstyled no matter what you write into it. Add every slide from the blank
layout, prs.slide_layouts[6], and place every element yourself. (A template
the user supplied is the exception: its placeholders are its design.)

Placing elements yourself does not mean guessing coordinates slide by slide.
Write one small layout module at the top of the build script and generate
every slide through it: a grid computed from the slide size, a per-deck STYLE
dict, one text helper, and five or six named layouts. The layouts fix WHERE
things go and are the same for a pitch, a report, or a wedding program; STYLE
fixes how things LOOK and is chosen fresh for each deck. A reference scaffold
— learn the shape, size it to your deck:

\`\`\`python
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN

BLANK = prs.slide_layouts[6]
W, H = prs.slide_width, prs.slide_height     # EMU, after setting 16:9
MARGIN = int(W * 0.07)                       # equal left and right
COL = (W - 2 * MARGIN) // 12                 # 12-column grid
def col_x(i): return MARGIN + i * COL
def col_w(n): return n * COL

STYLE = {  # this deck's look — chosen fresh per deck, never carried over
    'display': ..., 'body': ...,              # installed, fc-list-verified families
    'ink': ..., 'paper': ..., 'accent': ...,  # RGBColor values from the subject
    'size': {'title': ..., 'heading': ..., 'body': ..., 'caption': ...},  # Pt, above the floors
}

def new_slide():
    s = prs.slides.add_slide(BLANK)
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = STYLE['paper']
    return s

def put_text(slide, left, top, width, height, text, role, align=PP_ALIGN.LEFT, color=None):
    box = slide.shapes.add_textbox(left, top, width, height)
    box.text_frame.word_wrap = True
    box.text_frame.vertical_anchor = MSO_ANCHOR.TOP
    for i, line in enumerate(text.split('\\n')):
        p = box.text_frame.paragraphs[0] if i == 0 else box.text_frame.add_paragraph()
        p.alignment = align
        run = p.add_run()                        # explicit run works even on a blank line
        run.text = line
        run.font.name = STYLE['display' if role in ('title', 'heading') else 'body']
        run.font.size = STYLE['size'][role]
        run.font.color.rgb = color or STYLE['ink']
    return box

def statement(c):                            # one big line, lots of air
    s = new_slide()
    put_text(s, col_x(1), int(H * 0.40), col_w(10), int(H * 0.24),
             c['line'], 'title', align=PP_ALIGN.CENTER)
    return s

def split(c):                                # image left, text right
    s = new_slide()
    s.shapes.add_picture(c['image'], 0, 0, height=H)  # pre-cropped so width lands at col_x(6)
    put_text(s, col_x(7), int(H * 0.20), col_w(5), int(H * 0.14), c['title'], 'heading')
    put_text(s, col_x(7), int(H * 0.36), col_w(5), int(H * 0.44), c['body'], 'body')
    return s

# title, section, full_bleed, content: same pattern — a few put_text calls on the grid
LAYOUTS = {'title': title, 'section': section, 'full_bleed': full_bleed,
           'split': split, 'statement': statement, 'content': content}
for c in SLIDES:  # the deck as data: [{'layout': 'split', 'title': ..., ...}, ...]
    LAYOUTS[c['layout']](c)
\`\`\`

- Model the deck as data: one SLIDES list of dicts (layout name plus content
  slots) drives the whole build. Uniform structure across slides is most of
  what reads as design.
- Adapt the set to the deck — rename a layout, drop one, add one — but every
  slide goes through a named layout function on the grid. One textbox placed
  at ad-hoc coordinates mid-deck and the system is gone.
- Variety comes from choosing a different layout per slide as the argument
  moves, not from restyling one layout. Read the layout column of SLIDES
  before building: if one name covers most of the deck or runs more than
  three slides straight, re-mix.

## Type and fonts

- The sandbox's default fonts read as unstyled: Liberation Sans, DejaVu, Arial,
  Calibri all say nobody chose this. Choose a characterful family that fits the
  deck's subject and tone, the way you choose the palette.
- Pick from high-quality libre families you can install — a menu by mood, not a
  mandate:
  - Editorial, modern, confident: Space Grotesk, Archivo, Manrope
  - Working deck, quiet and legible: Source Sans 3, IBM Plex Sans, Figtree
  - Elegant, literary, celebratory: Fraunces, Newsreader, Playfair Display
  - Technical, data-heavy: IBM Plex Sans with IBM Plex Mono for figures
- Use at most two families (display plus body), or one family at two weights
  with a real jump between them.
- Install before you style: download the family's TTFs (the Google Fonts GitHub
  repo and the Fontsource CDN both serve them), copy them to ~/.fonts, run
  fc-cache -f. Then verify: fc-list | grep -i <family> must list every weight
  you use.
- Never judge a render before fc-list confirms the font. A named-but-absent font
  falls back at render time without warning, so you would be approving
  Liberation Sans while believing you shipped Fraunces.
- If installation fails, pick the most characterful family fc-list already
  shows. A present font you chose beats an absent font you named.

## Images

- Source every photograph with runtime-image_search-1. It returns real,
  high-quality photos from the web (dimensions and attribution when the source
  provides them) with a direct image_url you can download in the sandbox. One
  query per subject, phrased as the caption reads: a slide captioned
  "Lisbon" is searched as "Lisbon trams", not covered by a generic
  "italy scenery" pile spread across the deck. Ask for several candidates and
  take the next one if a download fails or the subject is wrong.
- Only place image URLs that image_search returned this run, or that came from
  a page you actually fetched with read_url. Never construct or recall an image
  URL — no picsum.photos, no source.unsplash.com, no guessed CDN links. A
  placeholder or random-image service is never acceptable: it returns an
  arbitrary photo, and an arbitrary photo under a real caption is a mislabeled
  deck.
- Choose from the results by fit: dimensions large enough for the slot without
  upscaling, title and source page matching the subject. Download the chosen
  image_url into the sandbox.
- Validate every download with Pillow before it goes near the deck: it decodes,
  and it fills its slot without upscaling.
- Carry attribution when the tool returns it (Wikimedia results always do, most
  libre licenses require credit): a small on-slide credit or a credits file next
  to the .pptx.
- If no result truly shows the subject, do not stretch a near-miss. Use a wider
  image — the region, the category — and caption it as what it is. A correct
  caption on a broader photo beats a wrong photo under a precise caption.
- Never fake an image with vector shapes. If a slide needs a picture, source a
  real photograph or generate one; rectangles and ovals posing as an
  illustration read as clip art.
- Do not reuse the same image on more than one slide (a recurring background is
  the exception).

## Mechanics that will silently ruin the deck

Format truths, not style choices — these hold for every deck:

- Never pass both width AND height to add_picture: python-pptx stretches the
  image to fit and portraits get squished flat. Pass one dimension and let the
  other follow the aspect ratio, or pre-crop the image to the exact target
  aspect with Pillow first. One way to cover-crop without distortion:

\`\`\`python
def crop_to_aspect(img, target_w, target_h):
    """Center cover-crop to a target aspect. Never distorts."""
    src_w, src_h = img.size
    if src_w / src_h > target_w / target_h:   # too wide: trim the sides
        new_w = int(src_h * target_w / target_h)
        left = (src_w - new_w) // 2
        return img.crop((left, 0, left + new_w, src_h))
    new_h = int(src_w * target_h / target_w)  # too tall: trim top/bottom
    top = (src_h - new_h) // 2
    return img.crop((0, top, src_w, top + new_h))
\`\`\`

- python-pptx fill transparency does not work. FillFormat has no .transparency;
  assigning one is a silent no-op that ships a fully opaque shape. If text
  needs help to read over an image, bake the treatment (darkening, a gradient,
  a blur) into the image itself with Pillow before placing it. Never draw a
  "semi-transparent" overlay shape — you cannot.
- Fonts: a named font the sandbox lacks silently falls back at render time, so
  the PDF you judge is not the deck you styled. Install and verify the font
  first — see Type and fonts above.
- Diagrams: only when they materially help — most ideas land better as a
  sentence. Build them from native shapes, and add connectors before nodes so
  edges sit behind the boxes.
- Keep one build script (tmp/build_deck.py) and patch it between runs;
  do not fork per-slide scripts.

## Overflow and overlap (must fix)

Before delivering, scan every slide programmatically: flag any shape whose
position + size extends past prs.slide_width / prs.slide_height (that content
is clipped), and any unintended overlap between text boxes. Print the slide
index and shape for each finding so a re-run shows it resolved.

## Verify by LOOKING (must do)

Check subjects BEFORE you build. After downloading, make a proof sheet of the
photos — a Pillow grid, at most 8 per sheet so each photo renders around 600px
wide, with its intended caption printed under it — and view each sheet with
workspace-view_image. Answer one question per photo, not per sheet: does this show
the thing the caption names? A skyline is not a hill town; a beach is not the
named beach unless the source says so. Any mismatch, or any photo you cannot
identify: replace it via image_search (viewing it full size if needed) before
writing a line of build code. A wrong image caught here costs one search; caught
after delivery it costs the deck.

1. Render:
   soffice --headless --convert-to pdf files/<deck>.pptx --outdir tmp/render/
   then pdftoppm -jpeg -r 110 tmp/render/<deck>.pdf tmp/render/slide
   (JPEG, not PNG — image-heavy slides as PNG blow past workspace-view_image's
   ~3MB single-image cap.)
2. Build one contact sheet of all pages — a Pillow grid of ~560x315 thumbnails
   saved as .jpg — and view it with workspace-view_image. Judge the whole deck at
   a glance: consistency, hierarchy at thumbnail size, stretched images,
   collisions. Re-ask the subject question for every image slide: a photo that
   does not show what its caption names is a must-fix, the same class as clipped
   text — never cosmetic.
3. View at full resolution any image slide whose subject you have not yet
   confirmed, then the title slide and whatever else looked suspect — for
   wrapping, contrast, and detail.
4. Fix, re-render, re-view. Converge in at most three loops. The contact sheet
   you judge last must come from the FINAL build.

## Delivery

- Every hard requirement the user named is a gate. A missing library is a
  one-line install, not a scope change; never reframe a dropped requirement as
  a design decision.
- Deliver the .pptx plus the rendered PDF next to it (pixel-faithful for
  viewers without your fonts), and tell the user what you visually verified.

## Google Slides

Build and verify a .pptx here first — it imports into Google Slides. If the
user wants it written to their Google account directly, check
runtime-search_tools-1 for a connected Google Slides/Drive integration;
otherwise deliver the .pptx and note it imports cleanly.`;

export const presentation_files_skill: SkillDefinition = {
  skill_slug: 'presentation-files',
  skill_name: 'Presentations',
  description:
    'Use when creating, editing, or verifying presentation decks (.pptx) or Google Slides. ' +
    'Narrative discipline, per-deck design process, a grid-based layout engine (blank layouts ' +
    'only — never the default template placeholders), image sourcing and attribution, ' +
    'python-pptx mechanics (aspect-safe images, no fill transparency), and render-and-view QA ' +
    'with workspace-view_image. Built on python-pptx, Pillow, and LibreOffice in the sandbox.',
  body: [guidance, sandbox_document_workflow].join('\n'),
};
