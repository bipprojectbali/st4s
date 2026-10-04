/** Branding overrides (app name, tagline, support URL). NULL = built-in default. */
import { readSettingsRow, type SettingsRow, upsertSettingsRow } from './settings.core';

export type Branding = { appName: string; appTagline: string; supportUrl: string | null };
export type BrandingSettings = {
  appName: string | null;
  appTagline: string | null;
  supportUrl: string | null;
};

export const BRANDING_DEFAULTS: Branding = {
  appName: 'st4s',
  appTagline: 'speech-to-text & text-to-speech server kompatibel OpenAI',
  supportUrl: null,
};

export function parseBranding(row: SettingsRow | null): BrandingSettings {
  return {
    appName: row?.appName ?? null,
    appTagline: row?.appTagline ?? null,
    supportUrl: row?.supportUrl ?? null,
  };
}

export function effectiveBranding(s: BrandingSettings): Branding {
  return {
    appName: s.appName?.trim() || BRANDING_DEFAULTS.appName,
    appTagline: s.appTagline?.trim() || BRANDING_DEFAULTS.appTagline,
    supportUrl: s.supportUrl?.trim() || BRANDING_DEFAULTS.supportUrl,
  };
}

/** Effective branding for layouts and meta tags (cached via the settings row). */
export async function getBranding(): Promise<Branding> {
  return effectiveBranding(parseBranding(await readSettingsRow()));
}

export async function upsertBranding(s: BrandingSettings): Promise<BrandingSettings> {
  await upsertSettingsRow({
    appName: s.appName?.trim() || null,
    appTagline: s.appTagline?.trim() || null,
    supportUrl: s.supportUrl?.trim() || null,
  });
  return parseBranding(await readSettingsRow());
}
