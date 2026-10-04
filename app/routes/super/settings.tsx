import { Alert, Button, Group, Stack, Tabs, Text, Title } from '@mantine/core';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { settingsOverview } from '@server/settings';
import { useQuery } from '@tanstack/react-query';
import { FiAlertCircle, FiRefreshCw } from 'react-icons/fi';
import { AuthSettingsCard } from '~/components/settings/AuthSettingsCard';
import { BrandingCard } from '~/components/settings/BrandingCard';
import { FeatureFlagsCard } from '~/components/settings/FeatureFlagsCard';
import { MaintenanceCard } from '~/components/settings/MaintenanceCard';
import { RateLimitSettingsCard } from '~/components/settings/RateLimitSettingsCard';
import { RetentionCard } from '~/components/settings/RetentionCard';
import { RuntimeInfoCard } from '~/components/settings/RuntimeInfoCard';
import { toJson } from '~/lib/loader-json';
import {
  fetchSettingsOverviewFull,
  pickAuth,
  pickRateLimit,
  type SettingsOverviewFull,
} from '~/lib/settings-api';
import type { Route } from './+types/settings';

export function meta() {
  return [{ title: 'Settings — st4s' }];
}

/** Server-render the current values so the page never flashes empty controls. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  return toJson<SettingsOverviewFull>(await settingsOverview());
}

const TABS = [
  { value: 'auth', label: 'Autentikasi' },
  { value: 'rate-limit', label: 'Rate limit' },
  { value: 'retention', label: 'Retensi log' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'features', label: 'Feature flags' },
  { value: 'branding', label: 'Branding' },
  { value: 'runtime', label: 'Runtime' },
];

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const q = useQuery({
    queryKey: ['settings-overview'],
    queryFn: fetchSettingsOverviewFull,
    initialData: loaderData,
  });
  const data = q.data;
  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }} maw={960}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>App Settings</Title>
          <Text size="sm" c="dimmed">
            Pengaturan runtime yang tersimpan di database. Setiap perubahan dicatat di Audit Log.
          </Text>
        </div>
        <Button
          size="sm"
          variant="light"
          leftSection={<FiRefreshCw size={14} />}
          loading={q.isFetching}
          onClick={() => q.refetch()}
        >
          Muat ulang
        </Button>
      </Group>
      {q.isError && (
        <Alert color="red" icon={<FiAlertCircle size={16} />} title="Gagal memuat pengaturan">
          {(q.error as Error).message}
        </Alert>
      )}
      <Tabs defaultValue="auth" keepMounted={false} variant="outline">
        <Tabs.List style={{ flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <Tabs.Tab key={t.value} value={t.value}>
              {t.label}
              {t.value === 'maintenance' && data.maintenance.enabled ? ' ●' : ''}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="auth" pt="md">
          <AuthSettingsCard
            initial={pickAuth(data.settings)}
            googleAuthConfigured={data.runtime.googleAuthConfigured}
          />
        </Tabs.Panel>
        <Tabs.Panel value="rate-limit" pt="md">
          <RateLimitSettingsCard
            initial={pickRateLimit(data.settings)}
            rateLimit={data.rateLimit}
          />
        </Tabs.Panel>
        <Tabs.Panel value="retention" pt="md">
          <RetentionCard state={data.retention} />
        </Tabs.Panel>
        <Tabs.Panel value="maintenance" pt="md">
          <MaintenanceCard
            state={{
              enabled: data.maintenance.enabled,
              message: data.maintenance.message,
              allowRoles: data.maintenance.allowRoles,
            }}
            defaults={data.maintenance.defaults}
          />
        </Tabs.Panel>
        <Tabs.Panel value="features" pt="md">
          <FeatureFlagsCard flags={data.features} />
        </Tabs.Panel>
        <Tabs.Panel value="branding" pt="md">
          <BrandingCard settings={data.branding.settings} defaults={data.branding.defaults} />
        </Tabs.Panel>
        <Tabs.Panel value="runtime" pt="md">
          <RuntimeInfoCard runtime={data.runtime} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
