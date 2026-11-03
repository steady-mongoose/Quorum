# Engraved art

These plates are the hero backgrounds for Avouch Social (issue #36, revision 2).
Each one is public domain or CC0. Nothing apocalyptic is used; the only battles are Doré's crusaders and Martin's Joshua. No plate shows a nude.
Martin's *Joshua Commanding the Sun to Stand Still* appears on the landing page, the sign-in form, the signed-in More / About page, and the public About band.

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
| Landing and sign-in; the public About band | John Martin, *Joshua Commanding the Sun to Stand Still*, 1827, mezzotint and etching. National Gallery of Art 2002.65.3. Trimmed of the paper edge and printed line, and toned to the tones of the plate it replaced | `martin-joshua-A.webp` (palette B: `martin-joshua-B.webp`) | https://commons.wikimedia.org/wiki/File:John_Martin,_Joshua_Commanding_the_Sun_to_Stand_Still,_1827,_NGA_124846.jpg | CC0 (NGA Open Access) |

The off-list works this table used to carry for Find, Groups, You, About, and the desk (Rembrandt,
Millet, and Durand after Trumbull) were removed in #116: Josh's approved artists are Doré, Martin,
Dürer, Rackham, and Bauer. The public About band uses the door's Martin plate; no new file.
Martin's *The Creation of Light* was replaced by *Joshua* on Oct 31: Josh wants no image that could be read as Christ.

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
| Groups | Gustave Doré, *The Crusaders' War Machinery*, Histoire des croisades, 1877: the whole plate | `plate-groups-A.webp`, `plate-groups-A-900.webp` | https://commons.wikimedia.org/wiki/File:Gustave_dore_crusades_the_crusaders_war_machinery.jpg | Public domain (artist died 1883) |
| A group | Gustave Doré, *Ruth and Boaz*, Doré's English Bible, 1866 | `plate-group-A.webp`, `plate-group-A-900.webp` | https://commons.wikimedia.org/wiki/File:069.Ruth_and_Boaz.jpg | Public domain (artist died 1883) |
| Find | Gustave Doré, *A Friendly Tournament*, Histoire des croisades, 1877: the whole plate | `plate-find-A.webp`, `plate-find-A-900.webp` | https://commons.wikimedia.org/wiki/File:Gustave_dore_crusades_a_friendly_tournament.jpg | Public domain (artist died 1883) |
| Messages | Albrecht Dürer, *Erasmus of Rotterdam*, 1526, engraving. National Gallery of Art 6672 | `plate-messages-A.webp`, `plate-messages-A-900.webp` | https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer,_Erasmus_of_Rotterdam,_1526,_NGA_6672.jpg | CC0 (NGA Open Access) |
| You | Gustave Doré, *The Battle of Antioch*, Histoire des croisades, 1877 | `plate-you-A.webp`, `plate-you-A-900.webp` | https://commons.wikimedia.org/wiki/File:Gustave_Dor%C3%A9-The_Battle_of_Antioch-_Plate_XVIII.jpg | Public domain (artist died 1883) |
| More / About | John Martin, *Joshua Commanding the Sun to Stand Still* (the door's plate) | `martin-joshua-A.webp` (no new file) | see the landing row above | CC0 (NGA Open Access) |
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
| Groups | Doré, *Troubadours Sing the Glories of the Crusades*, 1877, https://commons.wikimedia.org/wiki/File:Gustave_dore_crusades_troubadours_singing_the_glories_of_the_crusades.jpg, public domain: the whole plate | Doré, *The Crusaders' War Machinery*, 1877: the whole plate | `plate-groups-A-2400.webp` |
| A group | Doré, *Ruth and Boaz*: the gleaners, left | the same plate: the reapers, right | `plate-group-A-2400.webp` |
| Find | Doré, *The Crusaders Cross Mount Taurus*, 1877, https://commons.wikimedia.org/wiki/File:Gustave_Dor%C3%A9_-_The_Crusaders_Cross_Mount_Taurus.jpg, public domain: the climbers. A man lying at the foot of the slope is taken into the dark | Doré, *A Friendly Tournament*, 1877: the whole plate | `plate-find-A-2400.webp` |
| Messages | Dürer, *Praying Hands*, 1508 | Dürer, *Erasmus of Rotterdam*, 1526 | `plate-messages-A-2400.webp` |
| You | Doré, *Bohemond Alone Mounts the Rampart of Antioch*, Histoire des croisades, 1877, https://commons.wikimedia.org/wiki/File:Gustave_dore_crusades_bohemond_alone_mounts_the_rampart_of_antioch.jpg, public domain (artist died 1883): the tower and Bohemond only. The crowd is taken into the dark, because a hooded man in a white robe stands in it who could be read as Christ | Doré, *The Battle of Antioch*, 1877: the whole plate. They replaced Dürer's self-portraits on Nov 2: Josh, many people would assume the 1500 portrait was Jesus, and he wants crusader art here | `plate-you-A-2400.webp` |
| The desk | Doré, *The Judgment of Solomon*: Solomon on the throne | the same plate: the elders at the far left of the scene; no sword or child | `plate-desk-A-2400.webp` |
| More / About | Martin, *Joshua Commanding the Sun to Stand Still* (`martin-joshua-A.webp`, already 2400 wide): the left of the plate | its right half | no new file |

### Section plates on About

Josh, Oct 31: Jesus is never featured, no crop cuts off a head, and each picture matches its section. Every
plate is credited under the picture, is a square under 90 KB, and is never cropped by the page. The sepia plates
have their levels lifted so the line work reads at this size. Only the crusader is a new scan.
What's in the rooms, The rooms and Kinds of post carry no plate: no work left fits them without repeating one on the page.

| Screen | Work | File | Source | Licence |
|---|---|---|---|---|
| What we stand for, and the picture a shared link shows (`share-avouch.jpg`, 1200×630 JPEG) | Gustave Doré, *The Count of Anjou at the Battle of Mansourah*, Histoire des croisades, 1877: the whole scene, the knight, his horse and the bearer of a plain cross; toned to sepia. The share image is a wider cut, fading out below the knight | `section-crusader.webp` | https://commons.wikimedia.org/wiki/File:Gustave_Dor%C3%A9_-_Count_of_Anjou_in_the_battle_of_Masouri,_1250.jpg | Public domain (artist died 1883) |
| Getting in and showing up | Gustave Doré, *Troubadours Sing the Glories of the Crusades*, 1877: the lower half of the plate, everyone who came to listen, the singers and the harper | `section-gathering.webp` | the Commons scan in the Groups row above | Public domain (artist died 1883) |
| Rooms and groups | Albrecht Dürer, *Saint Jerome in His Study*, 1514: a room; the cross on the desk is out of frame | `section-study.webp` | `durer-jerome-band-A.webp` | CC0 (NGA Open Access) |
| Talking to people | Albrecht Dürer, *Erasmus of Rotterdam*, 1526 | `section-writing.webp` | `plate-messages-A-900.webp` | CC0 (NGA Open Access) |
| Keeping it clean | Gustave Doré, *The Judgment of Solomon*, 1866: Solomon only, no sword or child | `section-judgment.webp` | `plate-desk-A-900.webp` | Public domain (artist died 1883) |

### Retouched Oct 31: a bare cross

Dürer's *Saint Jerome* has a crucifix on the desk. Josh, Oct 31: a crucifix without Christ on it is fine. In
`plate-rooms-A`, `plate-rooms-A-900`, `durer-jerome-band-A` and `-B` (with their 900px files) and `durer-jerome-side-A`
and `-B` the figure is painted out with the wall beside it, so a bare cross stands there. `plate-rooms-A-2400` and
`section-study` never showed it. Nothing else in those files changed.

### Recut Oct 31: no Jesus, no heads cut

`plate-room-A` (all three sizes) shows only the listeners from *The Sermon on the Mount*: Christ and the figures
around him are out of every crop, and the left panel is the crowd left of them. (The Groups plate recut that day
was retired on Nov 3; see below.)
`plate-group-A` and `plate-messages-A` are cut from their 2400 files, which keep every head. The 1600
Messages plate keeps Erasmus alone, so its credit stays true. All four 1600 files set the 16:9 art on the
dark ground at 1600×1000, so a 16:10 screen shows it whole, and the two recut phone files keep the art inside
the middle 738px a phone shows. Other screen shapes can still trim an edge figure.

### Retired Nov 3: no nude art

Josh, Nov 3: no prominently featured nude art, male or female. Bauer's *Princess Tuvstarr* (Find) is a nude girl, and
Dürer's *Feast of the Rose Garlands* (Groups, and About's Getting in square) has naked cherubs and the Christ Child.
All three are replaced by clothed Doré crusade plates; Bauer no longer appears in the app. Before using a plate,
check every figure for nudity as well as for Christ and cut heads, including cherubs and children.

Rejected: Doré's *The Order of Chivalry* (a crucified Christ on the wall).
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
