# Engraved art

These plates are the hero backgrounds for Avouch Social (issue #36, revision 2).
Each one is public domain or CC0. Nothing violent or apocalyptic is used.
Martin's *Creation of Light* appears on the landing page, the sign-in form, the signed-in More / About page, and the public About, Privacy, and Terms band.

The files in this folder are the Design Critic's duotone WebPs (palette A, Ink & Bone,
and palette B, Parchment & Lapis). Luminance is mapped from the ground colour to the
text colour. Most are not upscaled past the source scan; a few 2400 panels are, by up to
about 1.5× (Find left 1.38× and right 1.52×, the room's right 1.35×, the desk's right 1.25×, the You 1600 plate 1.10×),
softened by the plates' light blur. CSS lives in
`public/backgrounds.css` and is loaded as its own stylesheet.

`dore-band-A.webp` and `dore-band-B.webp` are those same colour duotones, resized to
1600×677 and re-encoded to about 160KB for the desktop week band. They are not
grayscale. The 900px mobile bands are the original files.
`dore-og.jpg` is a 1200×630 JPEG of that crop, about 150KB or less, for the
public gathering link preview. `dore-og.webp` is the same crop. No gathering
text is drawn on either.

| Screen | Work | File | Commons | Licence |
|---|---|---|---|---|
| This week, hero band and margin | Gustave Doré, *Jacob's Dream*, Doré's English Bible, 1866 | `dore-band-A.webp`, `dore-band-A-900.webp`, `dore-side-A.webp` (palette B: `*-B*`) | https://commons.wikimedia.org/wiki/File:021.Jacob%27s_Dream.jpg | Public domain (artist died 1883) |
| Rooms, hero band and margin. Messages hero band | Albrecht Dürer, *Saint Jerome in His Study*, 1514, engraving. National Gallery of Art scan, object 6642 | `durer-jerome-band-A.webp`, `durer-jerome-band-A-900.webp`, `durer-jerome-side-A.webp` (palette B: `*-B*`) | https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer,_Saint_Jerome_in_His_Study,_1514,_NGA_6642.jpg | CC0 (NGA Open Access) |
| Messages, margin column | Albrecht Dürer, *Study of an Apostle's Hands (Praying Hands)*, 1508, brush drawing (Albertina) | `durer-hands-side-A.webp` (palette B: `durer-hands-side-B.webp`) | https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer_-_Praying_Hands,_1508_-_Google_Art_Project.jpg | Public domain (artist died 1528) |
| Landing and sign-in; the public About, Privacy, and Terms band (right half) | John Martin, *Paradise Lost: The Creation of Light*, 1824–27, mezzotint. Cleveland Museum of Art 1983.84 | `martin-hero-A.webp` (palette B: `martin-hero-B.webp`) | https://commons.wikimedia.org/wiki/File:John_Martin_-_Paradise_Lost-_The_Creation_of_Light_-_1983.84_-_Cleveland_Museum_of_Art.tif | CC0 (CMA Open Access) |

The off-list works this table used to carry for Find, Groups, You, About, and the desk (Rembrandt,
Millet, and Durand after Trumbull) were removed in #116: Josh's approved artists are Doré, Martin,
Dürer, Rackham, and Bauer. The public About, Privacy, and Terms band now uses Martin's *Creation of
Light* (`martin-hero-A.webp` / `-B`, right half), the door's file; no new file.

## Signed-in plates (inner pages spec v3)

Every signed-in page now has one full-bleed plate behind the whole viewport, under a scrim, the door's
technique. The files are `plate-<key>-A.webp` (1600×1000; the You plate is upscaled 1.10× from the
1453px scan) and `plate-<key>-A-900.webp` (900×1600, for phones up to 640px). Each was turned grey, mapped
through a warm sepia LUT from `#100c09` to `#968466` with gamma 1.25, and lightly blurred, so they read
as one family. Printed captions and borders are trimmed off the Doré pages. CSS lives in
`public/page-craft.css`. Save-Data and reduced data drop the plate.

| Screen | Work | File | Commons | Licence |
|---|---|---|---|---|
| This week | Gustave Doré, *Jacob's Dream*, Doré's English Bible, 1866 | `plate-week-A.webp`, `plate-week-A-900.webp` | https://commons.wikimedia.org/wiki/File:021.Jacob%27s_Dream.jpg | Public domain (artist died 1883) |
| Rooms | Albrecht Dürer, *Saint Jerome in His Study*, 1514, engraving. National Gallery of Art 6642 | `plate-rooms-A.webp`, `plate-rooms-A-900.webp` | https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer,_Saint_Jerome_in_His_Study,_1514,_NGA_6642.jpg | CC0 (NGA Open Access) |
| A room | Gustave Doré, *The Sermon on the Mount*, Doré's English Bible, 1866 | `plate-room-A.webp`, `plate-room-A-900.webp` | https://commons.wikimedia.org/wiki/File:Dore_Bible_Sermon_on_the_Mount.jpg | Public domain (artist died 1883) |
| Groups | Albrecht Dürer, *The Feast of the Rose Garlands*, 1506, oil on panel (National Gallery Prague); toned to sepia monochrome like the others | `plate-groups-A.webp`, `plate-groups-A-900.webp` | https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer_-_Feast_of_Rose_Garlands_-_Google_Art_Project.jpg | Public domain (artist died 1528) |
| A group | Gustave Doré, *Ruth and Boaz*, Doré's English Bible, 1866 | `plate-group-A.webp`, `plate-group-A-900.webp` | https://commons.wikimedia.org/wiki/File:069.Ruth_and_Boaz.jpg | Public domain (artist died 1883) |
| Find | John Bauer, *Princess Tuvstarr gazing down into the dark waters of the forest tarn*, 1913 | `plate-find-A.webp`, `plate-find-A-900.webp` | https://commons.wikimedia.org/wiki/File:John_Bauer_-_Princess_Tuvstarr_gazing_down_into_the_dark_waters_of_the_forest_tarn._-_Google_Art_Project.jpg | Public domain (artist died 1918) |
| Messages | Albrecht Dürer, *Erasmus of Rotterdam*, 1526, engraving. National Gallery of Art 6672 | `plate-messages-A.webp`, `plate-messages-A-900.webp` | https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer,_Erasmus_of_Rotterdam,_1526,_NGA_6672.jpg | CC0 (NGA Open Access) |
| You | Albrecht Dürer, *Self-Portrait at Thirteen*, 1484, silverpoint (Albertina) | `plate-you-A.webp`, `plate-you-A-900.webp` | https://commons.wikimedia.org/wiki/File:Durer-self-portrait-at-the-age-of-thirteen.jpg | Public domain (artist died 1528) |
| More / About | John Martin, *The Creation of Light* (the door's plate) | `martin-hero-A.webp` (no new file) | see the landing row above | CC0 (CMA Open Access) |
| The desk | Gustave Doré, *The Judgment of Solomon*, Doré's English Bible, 1866. Cropped to Solomon on the throne and his court; the soldier's sword and the child are in no crop | `plate-desk-A.webp`, `plate-desk-A-900.webp` | https://commons.wikimedia.org/wiki/File:084.The_Judgment_of_Solomon.jpg | Public domain (artist died 1883) |

### Two sides at 1600px and wider (Josh, Oct 29: art on both sides of the text, never the same picture twice)

From 1600px each signed-in page swaps to a 2400×1350 plate, `plate-<key>-A-2400.webp`, under 140 KB each.
It is two panels, 960 px wide, one at each edge, with the middle (under the 60rem column) eased to the
page's darkest tone. The left and right panels are different works, or crops of one work that do not
share a figure. Same sepia LUT and a 0.8 px blur. `art-two-sides.test.ts` holds the manifest below and
fails if any screen at 1600, 1920 or 2560 shows the same file or panel twice, or an artist off the list.
1100 to 1599px keep the single 1600px plate.

| Screen | Left edge | Right edge | File |
|---|---|---|---|
| This week | Doré, *Jacob's Dream*: Jacob asleep (lower left) | the same plate: the lit top of the ladder and angels | `plate-week-A-2400.webp` |
| Rooms | Dürer, *Saint Jerome in His Study*: the sleeping lion | the same plate: Jerome at his desk | `plate-rooms-A-2400.webp` |
| A room | Doré, *The Sermon on the Mount*: the seated listeners, lower left | the same plate: the listeners, lower right, fading into the ground at the top | `plate-room-A-2400.webp` |
| Groups | Dürer, *The Feast of the Rose Garlands*: the pope's party | the same work: the emperor's party | `plate-groups-A-2400.webp` |
| A group | Doré, *Ruth and Boaz*: the gleaners, left | the same plate: the reapers, right | `plate-group-A-2400.webp` |
| Find | Bauer, *Princess Tuvstarr*: Tuvstarr at the tarn | the same work: the trees at the far left of the scene | `plate-find-A-2400.webp` |
| Messages | Dürer, *Praying Hands*, 1508 | Dürer, *Erasmus of Rotterdam*, 1526 | `plate-messages-A-2400.webp` |
| You | Dürer, *Self-Portrait at Thirteen*, 1484 | Dürer, *Self-Portrait*, 1500 (Alte Pinakothek), https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer_-_1500_self-portrait_(High_resolution_and_detail).jpg, public domain (artist died 1528) | `plate-you-A-2400.webp` |
| The desk | Doré, *The Judgment of Solomon*: Solomon on the throne | the same plate: the elders at the far left of the scene; no sword or child | `plate-desk-A-2400.webp` |
| More / About | Martin, *The Creation of Light* (`martin-hero-A.webp`, already 2400 wide): the left of the plate | its right half | no new file |

### Section plates on About

Josh, Oct 31: Jesus is never featured, no crop cuts off a head, and each picture matches its section. Every
plate here is cut from files above and credited under the picture. No new scan and no new licence.
`section-<key>.webp` is under 90 KB, the upright ones at their source's full width; the sepia plates have their levels lifted so the line work reads at this size.
What's in the rooms, The rooms and Kinds of post carry no plate: no work left fits them without repeating one on the page.

| Screen | Work | File | Cut from | Licence |
|---|---|---|---|---|
| What we stand for | Gustave Doré, *Ruth and Boaz*, 1866: a reaper and his sheaf, honest work. The top of the crop fades into the print's sky, because the print's own top edge runs through two far figures | `section-harvest.webp` | `plate-group-A-2400.webp` | Public domain (artist died 1883) |
| Getting in and showing up | Albrecht Dürer, *The Feast of the Rose Garlands*, 1506: the pope's party, people who turned up | `section-gathering.webp` | `plate-groups-A-2400.webp` | Public domain (artist died 1528) |
| Rooms and groups | Albrecht Dürer, *Saint Jerome in His Study*, 1514: a room; the crucifix on the sill is out of frame | `section-study.webp` | `durer-jerome-band-A.webp` | CC0 (NGA Open Access) |
| Keeping it clean | Gustave Doré, *The Judgment of Solomon*, 1866: Solomon only, no sword or child | `section-judgment.webp` | `plate-desk-A.webp` | Public domain (artist died 1883) |
| Talking to people | Albrecht Dürer, *Erasmus of Rotterdam*, 1526: a man writing to someone, for messages and posts | `section-writing.webp` | `plate-messages-A-900.webp` | CC0 (NGA Open Access) |

### Recut Oct 31: no Jesus, no heads cut

`plate-room-A` (all three sizes) shows only the listeners from *The Sermon on the Mount*: Christ and the figures
around him are out of every crop, and the left panel is the crowd left of them. `plate-groups-A` and its 900px file
show only the two parties at the sides of *The Feast of the Rose Garlands*: the Virgin and the Child are out.
`plate-group-A` and `plate-messages-A` are cut from their 2400 files, which keep every head. The 1600
Messages plate keeps Erasmus alone, so its credit stays true. All four 1600 files set the 16:9 art on the
dark ground at 1600×1000, so a 16:10 screen shows it whole, and the two recut phone files keep the art inside
the middle 738px a phone shows. Other screen shapes can still trim an edge figure.

Rejected: the MFAH photograph of Martin's *Adam and Eve, the Morning Hymn* is CC BY-SA 4.0, not public domain or CC0. None of Martin's destruction scenes are used.
Rejected: Jost Amman's *Der Schreiner* (1568) for Groups. The Wellcome scan is CC BY 4.0, and the public-domain scans are about 500 px wide, too small without upscaling.

Mobile (max-width 640px) uses the 900px-wide band files. `prefers-reduced-data` drops every plate. The section attribute is
set after the first paint, so the images are not part of the largest contentful paint.
The hero band has a fixed height, so the image does not move the layout when it arrives.

## Type

EB Garamond, by Georg Duffner and Octavio Pardo, SIL Open Font License 1.1.
The license is `public/fonts/OFL.txt`. The shipped files are a Latin subset of the
variable fonts from `google/fonts/ofl/ebgaramond`, in WOFF2, about 100KB together.
Only the roman is preloaded. The italic loads if a heading asks for it.

Public Sans, by the U.S. Web Design System (USWDS), SIL Open Font License 1.1.
The license is `public/fonts/OFL-PublicSans.txt`. The shipped files are the Latin
subset of the variable font from `@fontsource-variable/public-sans` 5.3.0, in WOFF2,
about 55KB together. Fonts are self-hosted; the app makes no Google Fonts request.
