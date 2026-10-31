import { useEffect, useState, type ReactNode } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { NotFoundPage } from "@/components/not-found";
import { rootMeta } from "@/lib/board/route-heads";
import appCss from "../styles.css?url";
import { markSaveData } from "@/lib/board/save-data";

// Before the first paint, so door.css can drop the engravings for data-saver users.
markSaveData();

export const Route = createRootRoute({
  head: () => ({
    meta: rootMeta(),
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: "/backgrounds.css" },
      { rel: "stylesheet", href: "/fluid.css" },
      { rel: "stylesheet", href: "/page-art.css" },
      { rel: "stylesheet", href: "/gathering.css" },
      { rel: "stylesheet", href: "/engraved-adjust.css" },
      { rel: "stylesheet", href: "/door.css" },
      { rel: "stylesheet", href: "/public-nav.css" },
      // Loads last: the full-bleed plate on every signed-in page (inner pages spec v2).
      { rel: "stylesheet", href: "/page-craft.css" },
      {
        rel: "preload",
        href: "/fonts/EBGaramond-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      {
        rel: "preload",
        href: "/fonts/PublicSans-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  notFoundComponent: NotFoundPage,
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <StaticSpaGate>
          <SingleOgTitle />
          <PreviewHostBridge />
          <AuthProvider>
            <Outlet />
          </AuthProvider>
        </StaticSpaGate>
        <Scripts />
      </body>
    </html>
  ),
});

/**
 * The Workers shell is one `index.html` for every URL. It is prerendered as an
 * empty route, then the client fills in whichever page the address asked for.
 * Rendering that page during hydration does not match the shell (React #418).
 * Hold the tree back until after hydration on the static build only.
 */
/** The preview injector writes one og:title, then the route writes its own. Keep the route's. */
function SingleOgTitle() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const tags = [...document.querySelectorAll('meta[property="og:title"]')];
    const keep = tags.at(-1);
    for (const tag of tags) {
      if (tag !== keep) tag.remove();
    }
  }, [pathname]);
  return null;
}

function StaticSpaGate({ children }: { children: ReactNode }) {
  const deferred = import.meta.env.VITE_STATIC_SPA === "true";
  const [ready, setReady] = useState(!deferred);
  useEffect(() => {
    if (deferred) setReady(true);
  }, [deferred]);
  if (!ready) return null;
  return children;
}
