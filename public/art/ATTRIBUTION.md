# Engraved art

These plates are the hero backgrounds for Avouch Social (issue #36, revision 2).
Each one is public domain or CC0. Nothing violent or apocalyptic is used.
Martin's *Creation of Light* appears on the landing page, the sign-in form, and the signed-in More / About page.

The files in this folder are the Design Critic's duotone WebPs (palette A, Ink & Bone,
and palette B, Parchment & Lapis). Luminance is mapped from the ground colour to the
text colour. They are not upscaled past the source scan. CSS lives in
`public/backgrounds.css` and is loaded as its own stylesheet.

`dore-band-A.webp` and `dore-band-B.webp` are those same colour duotones, resized to
1600×677 and re-encoded to about 160KB for the desktop week band. They are not
grayscale. The 900px mobile bands and the margin plates are the original files.
`dore-og.jpg` is a 1200×630 JPEG of that crop, about 150KB or less, for the
public gathering link preview. `dore-og.webp` is the same crop. No gathering
text is drawn on either.

| Screen | Work | File | Commons | Licence |
|---|---|---|---|---|
| This week, hero band and margin | Gustave Doré, *Jacob's Dream*, Doré's English Bible, 1866 | `dore-band-A.webp`, `dore-band-A-900.webp`, `dore-side-A.webp` (palette B: `*-B*`) | https://commons.wikimedia.org/wiki/File:021.Jacob%27s_Dream.jpg | Public domain (artist died 1883) |
| Rooms, hero band and margin. Messages hero band | Albrecht Dürer, *Saint Jerome in His Study*, 1514, engraving. National Gallery of Art scan, object 6642 | `durer-jerome-band-A.webp`, `durer-jerome-band-A-900.webp`, `durer-jerome-side-A.webp` (palette B: `*-B*`) | https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer,_Saint_Jerome_in_His_Study,_1514,_NGA_6642.jpg | CC0 (NGA Open Access) |
| Messages, margin column | Albrecht Dürer, *Study of an Apostle's Hands (Praying Hands)*, 1508, brush drawing (Albertina) | `durer-hands-side-A.webp` (palette B: `durer-hands-side-B.webp`) | https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer_-_Praying_Hands,_1508_-_Google_Art_Project.jpg | Public domain (artist died 1528) |
| Landing and sign-in only | John Martin, *Paradise Lost: The Creation of Light*, 1824–27, mezzotint. Cleveland Museum of Art 1983.84 | `martin-hero-A.webp` (palette B: `martin-hero-B.webp`) | https://commons.wikimedia.org/wiki/File:John_Martin_-_Paradise_Lost-_The_Creation_of_Light_-_1983.84_-_Cleveland_Museum_of_Art.tif | CC0 (CMA Open Access) |
| Find, hero band and outer plates | Rembrandt van Rijn, *Christ Preaching (La Petite Tombe)*, about 1652, etching. Metropolitan Museum of Art | `rembrandt-preaching-band-A.webp`, `rembrandt-preaching-band-A-900.webp`, `rembrandt-preaching-side-A.webp` (palette B: `*-B*`) | https://commons.wikimedia.org/wiki/File:Christ_Preaching,_called_La_Petite_Tombe_MET_DP832290.jpg | CC0 (Met Open Access) |
| Groups, hero band and margin | Jean-François Millet, *The Diggers (Les bêcheurs)*, about 1855–56, etching. National Gallery of Art 9192 | `millet-diggers-band-A.webp`, `millet-diggers-band-A-900.webp`, `millet-diggers-side-A.webp` (palette B: `*-B*`) | https://commons.wikimedia.org/wiki/File:Jean-Fran%C3%A7ois_Millet,_The_Diggers_(Les_becheurs),_NGA_9192.jpg | CC0 (NGA Open Access) |
| You, hero band and margin | Rembrandt van Rijn, *Self-Portrait Leaning on a Stone Sill*, 1639, etching. National Gallery of Art 35136 | `rembrandt-self-band-A.webp`, `rembrandt-self-band-A-900.webp`, `rembrandt-self-side-A.webp` (palette B: `*-B*`) | https://commons.wikimedia.org/wiki/File:Rembrandt_van_Rijn,_Self-Portrait_Leaning_on_a_Stone_Sill,_1639,_NGA_35136.jpg | CC0 (NGA Open Access) |
| About, Privacy, and Terms, hero band and margin | Rembrandt van Rijn, *The Three Trees*, 1643, etching. National Gallery of Art 43418 | `rembrandt-trees-band-A.webp`, `rembrandt-trees-band-A-900.webp`, `rembrandt-trees-side-A.webp` (palette B: `*-B*`) | https://commons.wikimedia.org/wiki/File:Rembrandt_van_Rijn,_The_Three_Trees,_1643,_NGA_43418.jpg | CC0 (NGA Open Access) |
| The desk, hero band and margin | Asher B. Durand after John Trumbull, *The Declaration of Independence*, 1823, engraving. Metropolitan Museum of Art | `durand-declaration-band-A.webp`, `durand-declaration-band-A-900.webp`, `durand-declaration-side-A.webp` (palette B: `*-B*`) | https://commons.wikimedia.org/wiki/File:The_Declaration_of_Independence_(July_4,_1776)_MET_49DD_388R3.jpg | CC0 (Met Open Access) |

The five works added for Find, Groups, You, About, and the desk were made the same way as the
Saint Jerome plates. Each scan was cut, turned to luminance, stretched between its 1st and 99th
percentile, and mapped between the palette's two ends: band A `#17130e` to `#857f73`, margin A
`#15110b` to `#76716a`, band B `#a29988` to `#ede2cd`, margin B `#a59c8a` to `#ece2cd`. The A
margin end is a step lighter than the older margin plates so it never reads as murk on the dark
ground. Bands are 1600×677 and 900×380, margins 1100 wide. The Declaration margin stays at 928
wide, its scan's own width, so it is not upscaled. Their CSS lives in `public/page-art.css`, so
`backgrounds.css` stays under its 3 KB budget.

## Signed-in plates (inner pages spec v3)

Every signed-in page now has one full-bleed plate behind the whole viewport, under a scrim, the door's
technique. The files are `plate-<key>-A.webp` (1600×1000, the You plate 1365×853 because its source is
small) and `plate-<key>-A-900.webp` (900×1600, for phones up to 640px). Each was turned grey, mapped
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
| The desk | Gustave Doré, *The Judgment of Solomon*, Doré's English Bible, 1866 | `plate-desk-A.webp`, `plate-desk-A-900.webp` | https://commons.wikimedia.org/wiki/File:084.The_Judgment_of_Solomon.jpg | Public domain (artist died 1883) |

Rejected: the MFAH photograph of Martin's *Adam and Eve, the Morning Hymn* is CC BY-SA 4.0, not public domain or CC0. None of Martin's destruction scenes are used.
Rejected: Jost Amman's *Der Schreiner* (1568) for Groups. The Wellcome scan is CC BY 4.0, and the public-domain scans are about 500 px wide, too small without upscaling.

Mobile (max-width 640px) uses the 900px-wide band files. Margin plates are desktop only
(min-width 1024px). `prefers-reduced-data` drops every plate. The section attribute is
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
