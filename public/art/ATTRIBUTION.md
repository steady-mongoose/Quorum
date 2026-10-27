# Engraved art

These plates are the hero backgrounds for Avouch Social (issue #36, revision 2).
Each one is public domain or CC0. Nothing violent or apocalyptic is used.
Martin's *Creation of Light* appears only on the landing page and the sign-in form.

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

Rejected: the MFAH photograph of Martin's *Adam and Eve, the Morning Hymn* is CC BY-SA 4.0, not public domain or CC0. None of Martin's destruction scenes are used.

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
