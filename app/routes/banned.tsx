import {
  Alert,
  Anchor,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { auth } from '@server/auth';
import { describeBan } from '@server/ban';
import { getBranding } from '@server/settings-branding';
import { useState } from 'react';
import { FiClock, FiHome, FiLifeBuoy, FiLogOut, FiSlash } from 'react-icons/fi';
import { Link, redirect, useNavigate } from 'react-router';
import { signOut } from '~/lib/auth-client';
import { useTimeFormat } from '~/lib/time-format';
import type { Route } from './+types/banned';

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `Akun diblokir — ${loaderData?.branding.appName ?? 'st4s'}` },
    { name: 'robots', content: 'noindex' },
  ];
}

/**
 * Shown to a signed-in user whose account is banned (guards redirect here).
 * Without a session — or once the ban lifted — there is nothing to show: /login.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  const ban = describeBan(session?.user);
  if (!session || !ban.active) throw redirect('/login');
  return { ban, email: session.user.email, branding: await getBranding() };
}

export default function Banned({ loaderData }: Route.ComponentProps) {
  const { dateTime: formatDateTime, relative: formatRelative } = useTimeFormat();
  const { ban, email, branding } = loaderData;
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const leave = async () => {
    setLeaving(true);
    try {
      await signOut();
      navigate('/login');
    } catch {
      setLeaving(false);
      notifications.show({ color: 'red', message: 'Gagal keluar. Coba lagi.' });
    }
  };

  return (
    <Container size="xs" py={64}>
      <Paper withBorder p={{ base: 'md', md: 'xl' }} radius="md" shadow="sm">
        <Stack gap="md">
          <Group gap="md" wrap="nowrap" align="flex-start">
            <ThemeIcon size={56} radius="md" variant="light" color="red">
              <FiSlash size={28} />
            </ThemeIcon>
            <div>
              <Title order={2} lh={1.2}>
                Akun Anda diblokir
              </Title>
              <Text size="sm" c="dimmed" mt={4}>
                {email} tidak bisa memakai {branding.appName}{' '}
                {ban.permanent ? 'sampai pemblokiran dicabut admin.' : 'untuk sementara.'}
              </Text>
            </div>
          </Group>

          <Alert
            color={ban.permanent ? 'red' : 'yellow'}
            variant="light"
            icon={<FiClock size={16} />}
            title={
              ban.permanent
                ? 'Pemblokiran permanen'
                : `Berakhir ${formatRelative(ban.until as string).replace('yang lalu', '')}`
            }
          >
            {ban.permanent
              ? 'Tidak ada tanggal berakhir. Akses kembali hanya bila admin mencabut pemblokiran.'
              : `Anda bisa masuk lagi setelah ${formatDateTime(ban.until as string)}. Sampai saat itu semua sesi ditolak.`}
          </Alert>

          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.3}>
              Alasan
            </Text>
            <Text size="sm">{ban.reason ?? 'Admin tidak mencantumkan alasan.'}</Text>
          </Stack>

          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.3}>
              Yang bisa Anda lakukan
            </Text>
            <Text size="sm">
              Bila menurut Anda ini keliru, hubungi dukungan dan sebutkan email akun Anda. Data Anda
              tidak dihapus; pemblokiran hanya menutup akses.
            </Text>
            {branding.supportUrl && (
              <Anchor href={branding.supportUrl} target="_blank" rel="noreferrer" size="sm">
                <Group gap={6} component="span">
                  <FiLifeBuoy size={14} />
                  Hubungi dukungan
                </Group>
              </Anchor>
            )}
          </Stack>

          <Group gap="xs" wrap="wrap">
            <Button
              size="sm"
              color="red"
              variant="light"
              leftSection={<FiLogOut size={14} />}
              loading={leaving}
              onClick={leave}
            >
              Keluar dari akun ini
            </Button>
            <Button
              size="sm"
              variant="default"
              component={Link}
              to="/"
              leftSection={<FiHome size={14} />}
            >
              Ke beranda
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
