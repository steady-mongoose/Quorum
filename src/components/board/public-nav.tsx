import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/board/model";

const PAGES = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

/** How far below the top of the window a heading counts as the section you are reading. */
const READING_LINE = 180;

type Section = { id: string; label: string };

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The page's own h2s, each given an address so the menu can jump to it. */
function readSections(): { sections: Section[]; headings: HTMLElement[] } {
  const headings = [...document.querySelectorAll<HTMLElement>("main h2")];
  const sections = headings.map((heading) => {
    const label = heading.textContent?.trim() ?? "";
    if (!heading.id) heading.id = slug(label);
    return { id: heading.id, label };
  });
  return { sections, headings };
}

/**
 * A row of links with one gilt light under them. It rests on the current link and
 * glides to whichever link the pointer or the keyboard is on. The policy allows no
 * style attribute, so the position is set through the CSS object model.
 */
function GlideRow({
  label,
  className,
  rowRef,
  children,
}: {
  label: string;
  className: string;
  rowRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const own = useRef<HTMLElement>(null);
  const row = rowRef ?? own;
  const light = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = row.current;
    if (!node) return;
    const rest = () => placeLight(node, light.current, null);
    rest();
    // The current link changes as you scroll, and web fonts change every link's width.
    const changes = new MutationObserver(rest);
    changes.observe(node, { attributes: true, attributeFilter: ["aria-current"], subtree: true });
    const resizes = new ResizeObserver(rest);
    resizes.observe(node);
    return () => {
      changes.disconnect();
      resizes.disconnect();
    };
  }, [row]);

  const glide = (target: EventTarget) => {
    const link = target instanceof Element ? target.closest("a") : null;
    if (link && row.current) placeLight(row.current, light.current, link);
  };
  const rest = () => {
    if (row.current) placeLight(row.current, light.current, null);
  };

  return (
    <nav
      ref={row}
      aria-label={label}
      className={className}
      onPointerOver={(event) => glide(event.target)}
      onPointerLeave={rest}
      onFocus={(event) => glide(event.target)}
      onBlur={rest}
    >
      {children}
      <span ref={light} className="pn-light" aria-hidden="true" />
    </nav>
  );
}

function placeLight(row: HTMLElement, light: HTMLElement | null, link: Element | null) {
  if (!light) return;
  const target = link ?? row.querySelector("[aria-current]");
  if (!(target instanceof HTMLElement)) {
    light.removeAttribute("data-on");
    return;
  }
  light.style.setProperty("--pn-x", `${target.offsetLeft}px`);
  light.style.setProperty("--pn-w", `${target.offsetWidth}px`);
  light.setAttribute("data-on", "");
}

/**
 * The menu on About, Privacy and Terms. The top row moves between pages. The row
 * under it moves between this page's sections and follows you as you read.
 */
export function PublicNav() {
  const { pathname } = useLocation();
  const [sections, setSections] = useState<Section[]>([]);
  const [reading, setReading] = useState("");
  const sectionRow = useRef<HTMLElement>(null);

  useEffect(() => {
    const found = readSections();
    setSections(found.sections);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const atEnd =
        window.scrollY > 0 &&
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const passed = found.headings.filter(
        (heading) => heading.getBoundingClientRect().top <= READING_LINE,
      );
      setReading((atEnd ? found.headings.at(-1) : passed.at(-1))?.id ?? "");
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  // On a phone the section row scrolls sideways: keep the one you are reading in view.
  useEffect(() => {
    const row = sectionRow.current;
    const link = row?.querySelector<HTMLElement>("[aria-current]");
    if (!row || !link) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollTo({
      left: link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2,
      behavior: still ? "auto" : "smooth",
    });
  }, [reading]);

  return (
    <header className="pn">
      <div className="pn-bar">
        <a href="/" className="pn-mark">
          {APP_NAME}
        </a>
        <GlideRow label="Pages" className="pn-row pn-pages">
          {PAGES.map((page) => (
            <a
              key={page.href}
              href={page.href}
              className="pn-link"
              aria-current={page.href === pathname ? "page" : undefined}
            >
              {page.href === "/" ? <ArrowLeft className="pn-back" aria-hidden="true" /> : null}
              <span className="pn-word">{page.label}</span>
            </a>
          ))}
        </GlideRow>
      </div>
      {sections.length > 1 ? (
        <GlideRow label="On this page" className="pn-row pn-sections" rowRef={sectionRow}>
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="pn-link"
              aria-current={section.id === reading ? "location" : undefined}
            >
              <span className="pn-word">{section.label}</span>
            </a>
          ))}
        </GlideRow>
      ) : null}
    </header>
  );
}
