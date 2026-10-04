import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import blueThemeCss from "../blue-theme.css?url";
import { EmeryDeviceContinuityBootstrap } from "../components/EmeryDeviceContinuityBootstrap";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="emery-text-gradient text-7xl font-bold">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">Emery couldn’t find that page.</p>
        <div className="mt-6">
          <Link
            to="/chat"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            Back to Emery
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="emery-glass max-w-md rounded-3xl p-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Emery hit a snag</h1>
        <p className="mt-2 text-sm text-muted-foreground">Try again or head back to your chat.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
          <a
            href="/chat"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-border bg-card px-4 text-sm font-medium text-foreground"
          >
            Back to chat
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Emery — Adam's Personal AI" },
      { name: "application-name", content: "Emery" },
      {
        name: "description",
        content: "Emery is Adam's private persistent personal AI companion.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#071a3d" },
      { name: "emery-build", content: "2026-09-30-hpo-map-routeonly-v4" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Emery" },
      { name: "format-detection", content: "telephone=no" },
      { property: "og:title", content: "Emery" },
      {
        property: "og:description",
        content: "Private persistent personal AI companion.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: blueThemeCss },
      { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/icon-512.png", sizes: "512x512" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <EmeryDeviceContinuityBootstrap />
      <Outlet />
    </QueryClientProvider>
  );
}
