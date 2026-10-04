/**
 * Email+password availability and the social sign-up rule, shared by the Better
 * Auth hooks (server/auth.ts) and the login page loader so the form and the API never disagree. Kept apart
 * from settings.ts because that module imports auth (cycle).
 */
import { hasGoogleAuth, signupDisabled, superAdminEmails } from './env';
import { isSuperAdminEmail } from './permissions';
import { readSettingsRow } from './settings.core';

export type AuthSettings = {
  emailAuthEnabled: boolean;
  signupEnabled: boolean;
};

export const AUTH_DEFAULTS: AuthSettings = { emailAuthEnabled: false, signupEnabled: true };

export type EmailAuthGate = { signIn: boolean; signUp: boolean };

/**
 * Pure rule: email counts as enabled when Google is not configured (it is then the
 * only login method, so switching it off would lock everyone out). Sign-up also
 * needs the DB toggle and must not be closed by AUTH_DISABLE_SIGNUP.
 */
export function resolveEmailAuthGate(
  s: AuthSettings,
  opts: { googleConfigured: boolean; signupClosedByEnv: boolean },
): EmailAuthGate {
  const signIn = s.emailAuthEnabled || !opts.googleConfigured;
  return { signIn, signUp: signIn && s.signupEnabled && !opts.signupClosedByEnv };
}

/** Effective email sign-in/sign-up availability for this process (settings row is cached briefly). */
export async function emailAuthGate(): Promise<EmailAuthGate> {
  const row = await readSettingsRow();
  return resolveEmailAuthGate(
    {
      emailAuthEnabled: row?.emailAuthEnabled ?? AUTH_DEFAULTS.emailAuthEnabled,
      signupEnabled: row?.signupEnabled ?? AUTH_DEFAULTS.signupEnabled,
    },
    { googleConfigured: hasGoogleAuth, signupClosedByEnv: signupDisabled },
  );
}

/**
 * Pure rule: a social sign-in may create a NEW user only while sign-up is open,
 * except for SUPER_ADMIN_EMAILS so the owner can never be locked out.
 */
export function maySocialSignUp(
  email: string,
  opts: { signupOpen: boolean; ownerEmails: ReadonlySet<string> },
): boolean {
  return opts.signupOpen || isSuperAdminEmail(email, opts.ownerEmails);
}

/** Whether a social sign-in for `email` may create a new user (DB toggle + AUTH_DISABLE_SIGNUP). */
export async function socialSignUpAllowed(email: string): Promise<boolean> {
  const row = await readSettingsRow();
  const signupOpen = (row?.signupEnabled ?? AUTH_DEFAULTS.signupEnabled) && !signupDisabled;
  return maySocialSignUp(email, { signupOpen, ownerEmails: superAdminEmails });
}
