import { SECTION_PLATE, type SectionPlateId } from "@/lib/board/engraved";

/**
 * A plate set in a section, as in a book: an engraved frame with its credit under it. It fills the width on a
 * phone and stands to the right of the text from tablet up, with the text wrapping past it. Data savers skip it.
 */
export function SectionPlate({ plate }: { plate: SectionPlateId }) {
  const { alt, caption } = SECTION_PLATE[plate];
  return (
    <figure className="section-plate">
      <img
        src={`/art/section-${plate}.webp`}
        width={900}
        height={900}
        alt={alt}
        loading="lazy"
        decoding="async"
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
