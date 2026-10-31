import { SECTION_PLATE, type SectionPlateId } from "@/lib/board/engraved";

/** A plate set in a section, as in a book: an engraved frame with its credit under it. Data savers skip it. */
export function SectionPlate({ plate }: { plate: SectionPlateId }) {
  const { alt, caption, tall } = SECTION_PLATE[plate];
  return (
    <figure className={tall ? "section-plate section-plate--tall" : "section-plate"}>
      <img
        src={`/art/section-${plate}.webp`}
        width={tall ? 750 : 1500}
        height={tall ? 1000 : 500}
        alt={alt}
        loading="lazy"
        decoding="async"
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
