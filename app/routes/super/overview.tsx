import { Alert, Badge, Button, Group, Stack, Text, Title } from '@mantine/core';
import { devOverview } from '@server/dev-overview';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { Link, useRevalidator } from 'react-router';
import { OverviewStats } from '~/components/overview/OverviewStats';
import { QuickLinks } from '~/components/overview/QuickLinks';
import { RecentActivity } from '~/components/overview/RecentActivity';
import { useTimeFormat } from '~/lib/time-format';
import type { Route } from './+types/overview';

export function meta() {
  return [{ title: 'Overview — st4s' }];
}

/** Everything is gathered server-side so the overview is complete at first paint. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  return devOverview();
}

export default function OverviewPage({ loaderData: data }: Route.ComponentProps) {
  const { dateTime: formatDateTime } = useTimeFormat();
  const revalidator = useRevalidator();
  const warnings: Array<{ key: string; text: string; to: string }> = [];
  if (!data.rateLimits.config.enabled)
    warnings.push({
      key: 'rl',
      text: 'Rate limiting nonaktif — API tidak dibatasi.',
      to: '/dev/settings',
    });
  if (!data.settings.emailAuthEnabled && !data.runtime.googleAuthConfigured)
    warnings.push({
      key: 'auth',
      text: 'Login email mati dan Google OAuth belum dikonfigurasi — tidak ada cara masuk.',
      to: '/dev/settings',
    });
  if (data.maintenance)
    warnings.push({
      key: 'maint',
      text: 'Mode maintenance aktif — pengunjung biasa melihat halaman pemeliharaan.',
      to: '/dev/settings',
    });
  if (!data.retentionConfigured)
    warnings.push({
      key: 'ret',
      text: 'Retensi log belum diatur — tabel log akan tumbuh tanpa batas.',
      to: '/dev/settings',
    });
  if (data.users.banned > 0)
    warnings.push({
      key: 'ban',
      text: `${data.users.banned} user sedang diblokir.`,
      to: '/dev/users',
    });
  if (data.apiKeys.expiringSoon > 0)
    warnings.push({
      key: 'keys',
      text: `${data.apiKeys.expiringSoon} API key berakhir dalam ${data.apiKeys.expiringSoonDays} hari — rotasi sebelum integrasi putus.`,
      to: '/dev/api-keys',
    });
  if (data.fileHealth && data.fileHealth.danger > 0)
    warnings.push({
      key: 'fh',
      text: `${data.fileHealth.danger} file berisiko meledakkan konteks agent.`,
      to: '/dev/file-health',
    });

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Group gap="xs">
            <Title order={3}>Overview</Title>
            <Badge variant="light" color={data.runtime.nodeEnv === 'production' ? 'red' : 'teal'}>
              {data.runtime.nodeEnv}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            Ringkasan kondisi aplikasi saat ini. Diperbarui {formatDateTime(data.generatedAt)}.
          </Text>
        </div>
        <Button
          size="sm"
          variant="light"
          leftSection={<FiRefreshCw size={14} />}
          loading={revalidator.state === 'loading'}
          onClick={() => revalidator.revalidate()}
        >
          Muat ulang
        </Button>
      </Group>

      {warnings.length > 0 && (
        <Alert
          color="orange"
          variant="light"
          icon={<FiAlertTriangle size={16} />}
          title="Perlu perhatian"
        >
          <Stack gap={4}>
            {warnings.map((w) => (
              <Group key={w.key} gap="xs" wrap="wrap">
                <Text size="sm">{w.text}</Text>
                <Button
                  component={Link}
                  to={w.to}
                  size="compact-xs"
                  variant="subtle"
                  prefetch="intent"
                >
                  Buka
                </Button>
              </Group>
            ))}
          </Stack>
        </Alert>
      )}

      <OverviewStats data={data} />
      <RecentActivity data={data} />
      <QuickLinks />
    </Stack>
  );
}
