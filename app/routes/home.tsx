import { Box } from '@mantine/core';
import { auth } from '@server/auth';
import { env } from '@server/env';
import { landingStats } from '@server/landing-stats';
import { homeFor } from '@server/permissions';
import { resolveUserRole } from '@server/roles';
import { getBranding } from '@server/settings-branding';
import { Hero } from '~/components/landing/Hero';
import { LandingHeader } from '~/components/landing/LandingHeader';
import { CtaSection, LandingFooter, QuickStartSection } from '~/components/landing/QuickStartCta';
import {
  ArchitectureSection,
  ConsoleSection,
  FaqSection,
  FeaturesSection,
  SecuritySection,
} from '~/components/landing/Sections';
import type { Route } from './+types/home';

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.branding.appName ?? 'st4s';
  const tagline =
    loaderData?.branding.appTagline ?? 'speech-to-text & text-to-speech server kompatibel OpenAI';
  const title = `${name} — ${tagline}`;
  const url = `${loaderData?.siteUrl ?? ''}/`;
  const image = `${loaderData?.siteUrl ?? ''}/og.png`;
  const description = `${name}: server speech-to-text & text-to-speech kompatibel OpenAI (Qwen3-ASR, Supertonic) dengan konsol admin, API key ber-scope, dan deploy satu binary.`;
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: name },
    { property: 'og:url', content: url },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
    { tagName: 'link', rel: 'canonical', href: url },
  ];
}

/** Public page: branding + live numbers, plus a session check so CTAs point to the right place. */
export async function loader({ request }: Route.LoaderArgs) {
  const [branding, stats, session] = await Promise.all([
    getBranding(),
    landingStats(),
    auth.api.getSession({ headers: request.headers }).catch(() => null),
  ]);
  const role = session?.user ? await resolveUserRole(session.user) : null;
  return {
    branding,
    stats,
    // Crawlers need absolute URLs for og:image/og:url; APP_URL is the public origin.
    siteUrl: env.APP_URL.replace(/\/$/, ''),
    signedIn: Boolean(session?.user),
    homePath: role ? homeFor(role) : '/login',
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { branding, stats, signedIn, homePath } = loaderData;
  return (
    <Box>
      <LandingHeader appName={branding.appName} signedIn={signedIn} homePath={homePath} />
      <Hero
        appName={branding.appName}
        tagline={branding.appTagline}
        stats={stats}
        signedIn={signedIn}
        homePath={homePath}
      />
      <FeaturesSection />
      <ConsoleSection />
      <SecuritySection />
      <ArchitectureSection />
      <QuickStartSection />
      <FaqSection />
      <CtaSection signedIn={signedIn} homePath={homePath} />
      <LandingFooter
        appName={branding.appName}
        version={stats.version}
        supportUrl={branding.supportUrl}
      />
    </Box>
  );
}
