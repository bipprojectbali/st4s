import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/nprogress/styles.css';

import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { getBranding } from '@server/settings-branding';
import { useEffect } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import type { Route } from './+types/root';
import { ErrorPage } from './components/errors/ErrorPage';
import { RouteProgress } from './components/RouteProgress';
import { describeError, ERROR_TITLE_SUFFIX } from './lib/error-page';
import { QueryProvider } from './lib/query';
import { theme } from './lib/theme';
import { rememberTimeZone, requestClock } from './lib/time-format';

/** Branding for the global title fallback (cached, no auth) + the SSR/hydration clock. */
export async function loader({ request }: Route.LoaderArgs) {
  return { branding: await getBranding(), clock: requestClock(request) };
}

export function meta({ loaderData, error }: Route.MetaArgs) {
  const name = loaderData?.branding.appName ?? 'st4s';
  const tagline =
    loaderData?.branding.appTagline ?? 'speech-to-text & text-to-speech server kompatibel OpenAI';
  // Error boundaries reuse the root meta: a 404 must not be titled like the home page.
  if (error) {
    const info = describeError(error);
    return [
      { title: `${info.status} ${info.title}${ERROR_TITLE_SUFFIX}` },
      { name: 'robots', content: 'noindex' },
    ];
  }
  return [
    { title: name },
    {
      name: 'description',
      content: `${name} — ${tagline}. Bun + Elysia + React Router SSR + Drizzle + Better Auth.`,
    },
  ];
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#4c6ef5" />
        <Meta />
        <Links />
        {/*
          ColorSchemeScript runs synchronously (blocking) in <head> and sets
          data-mantine-color-scheme on <html> BEFORE first paint. Its
          defaultColorScheme must match MantineProvider's to avoid a flip.
        */}
        <ColorSchemeScript defaultColorScheme="auto" />
        {/*
          Anti-FOUC: paint the correct background at first paint, before the
          main Mantine stylesheet is applied (in dev Vite injects that CSS via
          JS after paint, which otherwise causes a white flash on hard reload).
          The attribute above is already set by ColorSchemeScript at this point.
        */}
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static anti-FOUC CSS
          dangerouslySetInnerHTML={{
            __html: `
:root { color-scheme: light; background-color: #fff; }
:root[data-mantine-color-scheme='dark'] { color-scheme: dark; background-color: #242424; }
:root[data-mantine-color-scheme='light'] { color-scheme: light; background-color: #fff; }
html, body { background-color: inherit; }

/* ThemeToggle: two variants always in DOM; CSS picks the visible one.
   ColorSchemeScript sets data-mantine-color-scheme before first paint,
   so the correct button is shown from the very first pixel — no flash. */
[data-mantine-color-scheme='dark'] .mk-cs-light { display: none !important; }
[data-mantine-color-scheme='light'] .mk-cs-dark  { display: none !important; }
:root:not([data-mantine-color-scheme]) .mk-cs-dark { display: none !important; }
`,
          }}
        />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useEffect(rememberTimeZone, []);
  return (
    <QueryProvider>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <RouteProgress />
        <Notifications position="top-right" />
        <ModalsProvider>
          <Outlet />
        </ModalsProvider>
      </MantineProvider>
    </QueryProvider>
  );
}

/** Last-resort boundary (no app shell): 404s, loader failures, render crashes. */
export function ErrorBoundary({ error, loaderData }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} appName={loaderData?.branding.appName} />;
}
