import { categoryPreview } from "./categories.ts";
import { APP_NAME } from "./model.ts";

const DESCRIPTION =
  "Your church, your shop, your county. Where a small set of people meet, what they did, and what the parish needs this week. The County room runs on Quorum.";

export type RouteMeta =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }
  | { charSet: string };

/** Default document head. A child route replaces title and og:title. */
export function rootMeta(): RouteMeta[] {
  return [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    { title: APP_NAME },
    { name: "description", content: DESCRIPTION },
    { name: "application-name", content: APP_NAME },
    { name: "apple-mobile-web-app-title", content: APP_NAME },
    { property: "og:title", content: APP_NAME },
    { property: "og:site_name", content: APP_NAME },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: APP_NAME },
    { name: "twitter:description", content: DESCRIPTION },
    { name: "theme-color", content: "#14100c" },
  ];
}

export function homeMeta(): RouteMeta[] {
  return [{ title: APP_NAME }, { property: "og:title", content: APP_NAME }];
}

export function roomsIndexMeta(): RouteMeta[] {
  return [
    { title: "Rooms · Avouch Social" },
    { property: "og:title", content: "Rooms" },
    { name: "robots", content: "noindex" },
  ];
}

export function categoryPageMeta(slug: string): RouteMeta[] {
  const preview = categoryPreview(slug);
  return [
    { title: `${preview.title} · Avouch Social` },
    { name: "description", content: preview.description },
    { name: "robots", content: "noindex" },
    { property: "og:title", content: preview.title },
    { property: "og:description", content: preview.description },
    { property: "og:image", content: preview.image },
    { property: "og:image:alt", content: preview.credit },
  ];
}

/**
 * The same last-match rule TanStack uses for meta property and name:
 * a child og:title replaces the root tag instead of adding a second one.
 */
export function renderedOgTitles(layers: readonly (readonly RouteMeta[])[]): string[] {
  const titles: string[] = [];
  let seen = false;
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const metas = layers[i] ?? [];
    for (let j = metas.length - 1; j >= 0; j -= 1) {
      const meta = metas[j];
      if (!meta || !("property" in meta) || meta.property !== "og:title") continue;
      if (seen) continue;
      seen = true;
      titles.push(meta.content);
    }
  }
  return titles.reverse();
}
