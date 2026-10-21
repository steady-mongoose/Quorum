import { useEffect, useState, type ReactNode } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { NotFoundPage } from "@/components/not-found";
import { APP_NAME } from "@/lib/board/model";
import appCss from "../styles.css?url";

const DESCRIPTION =
  "Your church, your shop, your county. Where a small set of people meet, what they did, and what the parish needs this week. The County room runs on Quorum.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
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
      { name: "theme-color", content: "#0f1a14" },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,640&family=Public+Sans:wght@400;500;600;700&display=swap",
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
function StaticSpaGate({ children }: { children: ReactNode }) {
  const deferred = import.meta.env.VITE_STATIC_SPA === "true";
  const [ready, setReady] = useState(!deferred);
  useEffect(() => {
    if (deferred) setReady(true);
  }, [deferred]);
  if (!ready) return null;
  return children;
}
