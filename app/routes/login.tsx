import {
  Button,
  Container,
  Divider,
  Paper,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { hasLength, isEmail, isNotEmpty, useForm } from '@mantine/form';
import { hasGoogleAuth } from '@server/env';
import { emailAuthGate } from '@server/settings-auth';
import { getBranding } from '@server/settings-branding';
import { useState } from 'react';
import { FcGoogle } from 'react-icons/fc';
import { useNavigate, useSearchParams } from 'react-router';
import { LoginNotice } from '~/components/login/LoginNotices';
import { signIn, signUp } from '~/lib/auth-client';
import { type AuthNotice, describeAuthError, loginNotice } from '~/lib/auth-errors';
import type { Route } from './+types/login';

export function meta({ loaderData }: Route.MetaArgs) {
  const app = loaderData?.branding.appName ?? 'Makuro';
  return [
    { title: `Masuk — ${app}` },
    {
      name: 'description',
      content: `Masuk ke ${app} dengan akun Google atau email untuk memakai layanan transkripsi suara (STT) dan sintesis suara (TTS) Anda.`,
    },
  ];
}

export async function loader() {
  const [gate, branding] = await Promise.all([emailAuthGate(), getBranding()]);
  return {
    googleEnabled: hasGoogleAuth,
    emailAuthEnabled: gate.signIn,
    signupEnabled: gate.signUp,
    branding,
  };
}

const MIN_PASSWORD = 8;

export default function Login({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { googleEnabled, emailAuthEnabled, signupEnabled, branding } = loaderData;
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  // Starts from the URL (guard redirect, OAuth callback), replaced by form results.
  const [notice, setNotice] = useState<AuthNotice | null>(() => loginNotice(searchParams));
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: '', email: '', password: '' },
    validate: {
      name: (value) => (mode === 'signup' ? isNotEmpty('Nama wajib diisi')(value) : null),
      email: isEmail('Email tidak valid'),
      password: hasLength({ min: MIN_PASSWORD }, `Minimal ${MIN_PASSWORD} karakter`),
    },
  });

  const submit = form.onSubmit(async (values) => {
    setNotice(null);
    setLoading(true);
    try {
      const res =
        mode === 'signup'
          ? await signUp.email({
              name: values.name || values.email,
              email: values.email,
              password: values.password,
            })
          : await signIn.email({ email: values.email, password: values.password });
      if (res.error) {
        setNotice(describeAuthError(res.error));
        return;
      }
      // /go resolves the role server-side and lands on the right area.
      navigate('/go');
    } catch (err) {
      setNotice(describeAuthError({ message: err instanceof Error ? err.message : null }));
    } finally {
      setLoading(false);
    }
  });

  async function continueWithGoogle() {
    setNotice(null);
    setGoogleLoading(true);
    try {
      // Success → /go (role-aware home). Failure (e.g. banned) → back here with ?error=<code>.
      const res = await signIn.social({
        provider: 'google',
        callbackURL: '/go',
        errorCallbackURL: '/login',
      });
      // Errors before the redirect (e.g. INVALID_ORIGIN) come back as a value, not a throw.
      if (res.error) {
        setNotice(describeAuthError(res.error));
        setGoogleLoading(false);
      }
    } catch (err) {
      setNotice(describeAuthError({ message: err instanceof Error ? err.message : null }));
      setGoogleLoading(false);
    }
  }

  const banned = notice?.kind === 'banned';

  return (
    <Container size="xs" py={64}>
      <Title order={2} mb="lg" ta="center">
        Selamat datang di {branding.appName}
      </Title>

      {emailAuthEnabled && signupEnabled && (
        <SegmentedControl
          fullWidth
          mb="md"
          value={mode}
          onChange={(v) => setMode(v as 'signin' | 'signup')}
          data={[
            { label: 'Masuk', value: 'signin' },
            { label: 'Daftar', value: 'signup' },
          ]}
        />
      )}

      <Paper withBorder p="lg" shadow="sm" radius="md">
        <Stack>
          <LoginNotice notice={notice} supportUrl={branding.supportUrl} />

          {googleEnabled && (
            <>
              {/* White chip keeps the multicolour icon legible on the filled button. */}
              <Button
                variant="filled"
                fullWidth
                leftSection={
                  <FcGoogle
                    size={18}
                    style={{ background: 'white', borderRadius: 4, padding: 1 }}
                  />
                }
                loading={googleLoading}
                disabled={banned}
                onClick={continueWithGoogle}
              >
                Lanjutkan dengan Google
              </Button>
              {emailAuthEnabled && <Divider label="atau" labelPosition="center" />}
            </>
          )}

          {emailAuthEnabled && (
            <form onSubmit={submit}>
              <Stack>
                {mode === 'signup' && signupEnabled && (
                  <TextInput
                    size="md"
                    label="Nama"
                    placeholder="Nama Anda"
                    key={form.key('name')}
                    {...form.getInputProps('name')}
                  />
                )}
                <TextInput
                  size="md"
                  label="Email"
                  placeholder="anda@contoh.com"
                  inputMode="email"
                  autoComplete="email"
                  key={form.key('email')}
                  {...form.getInputProps('email')}
                />
                <PasswordInput
                  size="md"
                  label="Kata sandi"
                  placeholder={`Minimal ${MIN_PASSWORD} karakter`}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  key={form.key('password')}
                  {...form.getInputProps('password')}
                />
                <Button
                  type="submit"
                  variant={googleEnabled ? 'default' : 'filled'}
                  loading={loading}
                  fullWidth
                >
                  {mode === 'signup' && signupEnabled ? 'Buat akun' : 'Masuk'}
                </Button>
              </Stack>
            </form>
          )}

          {emailAuthEnabled && !signupEnabled && (
            <Text c="dimmed" size="sm" ta="center">
              Pendaftaran akun baru ditutup. Hubungi administrator untuk dibuatkan akun.
            </Text>
          )}

          {!googleEnabled && !emailAuthEnabled && (
            <Text c="dimmed" size="sm" ta="center">
              Login tidak tersedia. Hubungi administrator.
            </Text>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
