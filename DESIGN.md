# How Avouch looks

Read this before changing anything people see. Avouch is meant to look like an engraved book from a church library,
not like a startup dashboard. Every page stands on one old engraving, toned to sepia, with the words on solid
cards in front of it. If a change makes a page look like a generic web app (white cards, bright blue buttons,
gradients, 3D icons, glass), it is wrong for Avouch, however good it looks elsewhere.

The art rules below are Josh's and are not up for trade-offs. The rest describes what the code already does, so
new work matches it. Where a rule has a test, the test is named; run the suite before opening a PR.

## The art

### Josh's rules

1. **Only five artists:** Gustave Doré, John Martin, Albrecht Dürer, Arthur Rackham and John Bauer. (Bauer is
   on the list but no longer appears in the app.)
2. **Jesus is never shown.** That includes the Christ Child, a crucifix with a figure on it, and any figure
   people could take for Christ: a long-haired bearded man, or a bearded man in a white robe, even in a work
   that has nothing to do with Christ. A bare cross is fine. Zoom in before deciding: Dürer's Jerome crucifix
   looked bare at page size and had a figure on it.
3. **No nudes,** male or female, anywhere they would be noticed. Cherubs, putti and bare children count.
4. **No head is cut off** by a crop, at any screen size. Check the top, bottom and side edges of every crop,
   including the phone file.
5. **The picture matches its section.** Choose it for what the section is about, not for which page it came
   from.
6. **No text on the art,** and **no picture twice on one screen.**
7. **Strong, active Christian subjects** are preferred: crusaders first (Doré's *Histoire des croisades*), then
   scenes like Joshua, Solomon or Jacob. Quiet devotional pictures (praying hands alone) don't suit a section
   that makes a claim, such as What we stand for.
8. **Nothing apocalyptic, no gore.** No corpses, none of Martin's destruction scenes. Battles are Doré's
   crusaders and Martin's Joshua only.
9. **Public domain or CC0 only.** A CC BY or CC BY-SA scan is not enough, even of a public-domain work.

Before a new plate ships, look at every figure in every crop it will be shown in, at 1920, 1440 and 375 wide,
for rules 2, 3 and 4. Then add it to `public/art/ATTRIBUTION.md` with its source and licence. Record rejected
works there too, with the reason, so nobody tries them again.

Tests: `art-two-sides.test.ts` (artists on the list, no file or panel twice, heads clear of the edges at 1600,
1920 and 2560, and "no page stands on a nude"), `page-art.test.ts` (About's plates: no Christ, each has its
section).

### Where each picture goes

`public/art/ATTRIBUTION.md` is the record of every picture: which page, which work, which crop, which file,
and why earlier choices were retired. The captions live in `src/lib/board/engraved.ts`. Change all three
together: the file, its caption and its row.

| Page | Work |
|---|---|
| The door (welcome, sign-in), About, 404 | Martin, *Joshua Commanding the Sun to Stand Still* |
| This week | Doré, *Jacob's Dream* |
| Rooms | Dürer, *Saint Jerome in His Study* |
| A room | Doré, *The Sermon on the Mount*, the listeners only |
| Groups | Doré, *Troubadours Sing the Glories of the Crusades* and *The Crusaders' War Machinery* |
| A group | Doré, *Ruth and Boaz* |
| Find | Doré, *The Crusaders Cross Mount Taurus* and *A Friendly Tournament* |
| Messages | Dürer, *Praying Hands* and *Erasmus of Rotterdam* |
| You | Doré, *Bohemond Alone Mounts the Rampart of Antioch* and *The Battle of Antioch* |
| The desk | Doré, *The Judgment of Solomon*, Solomon and his court, no sword or child |

### Plate files

Each signed-in page has one plate behind the whole screen, in three files:

| File | Size | Shown |
|---|---|---|
| `plate-<key>-A-900.webp` | 900×1600 | phones, up to 640px |
| `plate-<key>-A.webp` | 1600×1000 | 641 to 1599px |
| `plate-<key>-A-2400.webp` | 2400×1350, under 140 KB | 1600px and wider |

The 2400 file is two 960px panels, one at each edge, with the middle (behind the text column) eased into the
page's darkest tone. The two panels are different works, or parts of one work that share no figure. The heads
in it must sit clear of the edges that wide screens show; `art-two-sides.test.ts` holds the head boxes.

All plates are one family: turned grey, mapped through a warm sepia ramp from near-black ink to a brown paper
tone (about `#968466`), and lightly blurred. A new plate should be toned the same way and checked side by side
with an existing one. Don't upscale a scan past about 1.5×.

About's section pictures are squares under 90 KB in a double gilt frame, credited underneath, never cropped by
the page (`public/page-art.css`, `.section-plate`). The picture a shared link shows is a 1200×630 JPEG.

Every plate is credited in small caps under the content (`.pc-credit`), in the form
`Artist · Work · Year`. Data savers (`navigator.connection.saveData`, or `prefers-reduced-data`) get no plate
and no credit.

## Colour

Two palettes. Ink & Bone is the default; Parchment & Lapis is the member's choice under You
(`[data-palette="parchment"]`). Tokens are in `src/styles.css` (`@theme`) and `public/backgrounds.css`
(`:root`). Use the tokens, never a new hex value.

| Role | Ink & Bone | Parchment & Lapis |
|---|---|---|
| Ground | `#14100c` | `#ece2cc` |
| Surface / card | `#1f1914` / `#241d16` | `#f3ecdc` / `#f8f3e7` |
| Text | `#f0e7d3` (bone) | `#1f1912` |
| Muted text | `#bcae94` | `#5e5242` |
| Hairline | `#3a3026` | `#d3c5a6` |
| Gilt (rules, kickers, frames) | `#c9a45c` | `#8f6f2f` |
| Accent | oxblood `#b4483e` | lapis `#24467d` |
| Button | bone `#f0e7d3`, ink text | lapis `#24467d`, paper text |

Gilt is for ornament: rules, diamonds, small-caps headings, frames. It is not a button colour. Each signed-in
section tints its cards slightly (`--pc-t1` to `--pc-t3` in `public/page-craft.css`); keep to that set.

## Type

- **EB Garamond** (`--font-display`) for headings, ledes, small-caps kickers and section headings, credits, and
  the names in a definition list.
- **Public Sans** (`--font-sans`) for body text, forms and buttons.
- Body text is 16px on a phone and grows to 18px on a wide desktop. Line height 1.5 to 1.6.
- Both fonts are self-hosted WOFF2 under the SIL Open Font License. Don't add a font or load one from a CDN.

## Building a page

Use the pieces that exist (`public/page-craft.css`, `public/door.css`):

- **Head:** a gilt small-caps kicker with a hairline after it (`.kicker`), a serif title, a gilt rule with a
  diamond at its start (`.pc-rule`), then a serif lede (`.pc-lede`).
- **Section heading:** gilt small caps with a hairline running out to the right (`.pc-h`).
- **Card:** `.card` or `.pc-card`, a solid toned card with a fine gilt inner line and a faint grain.
- **A list of named rules:** the name in a fixed left column and its text beside it, so rows line up; on a phone
  the name sits above its text on the same left edge (`.door-terms`).

Rules:

- **Text never sits on the art.** Every block goes on a card. Loose text left outside one gets a solid
  backing that fits the text, which looks uneven; put it on a card instead. Test:
  `inner-pages.render.test.mjs` walks every text node.
- **The column is narrow on desktop** (60rem from 1100px), so the plate shows at both sides.
- **Rows line up.** Inputs and buttons in a repeated row sit in grid columns, not wrapped flex, so every row
  is the same width. Test: `layout-gaps.test.ts`.
- **No horizontal scroll** at phone width (375px) or any wider screen.
- **Components:** the Radix primitives already in `package.json`, Tailwind classes and the classes above. Don't
  add a UI kit or a second component library; one changes keyboard and focus behaviour from screen to screen.
- `public/page-craft.css` has a 3 KB gzipped budget (`page-craft.test.ts`).

## Motion

Once, gentle, and only for people who haven't asked for less motion:

- A plate settles in over 4.5s; cards fade in over 0.5s. The door's plate drifts once, for 5s, then rests.
- Nothing moves for longer than 5s. The only loops are the small live dot and the pulse on a loading
  placeholder.
- The page title and the main action never move or fade.
- `prefers-reduced-motion: reduce` stops all of it.

## Focus and contrast

- Every control has a visible focus ring: 2px in the text colour with a 2px offset. Over a plate it also gets
  a dark halo, so it reads on any part of the picture.
- Text on cards meets WCAG AA contrast. Check the lightest part of a plate behind any element that is not on a
  card.

## Words

Plain words and short sentences, in the voice of a parish notice or a club post, not marketing. Name buttons
for what they do ("Save", "Remove"). When the same button repeats down a list, give each one an accessible
label that names its row, as the category editor does (`Save ${category.name}`).
