import { Alert, Button, Center, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { introspectDrizzleSchema } from '@server/db/schema-introspect';
import { schemaStats } from '@server/db/schema-stats';
import { requireRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { lazy, Suspense, useState } from 'react';
import { FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { useRevalidator } from 'react-router';
import type { Direction } from '~/components/db-schema/erd.layout';
import { SchemaStatsCards } from '~/components/db-schema/SchemaStatsCards';
import { SchemaToolbar } from '~/components/db-schema/SchemaToolbar';
import { TableDetailDrawer } from '~/components/db-schema/TableDetailDrawer';
import { useTimeFormat } from '~/lib/time-format';
import type { Route } from './+types/db-schema';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'DB Schema — st4s' }];
}

// React Flow touches browser APIs, so the canvas is loaded on the client only.
const SchemaGraph = lazy(() =>
  import('~/components/db-schema/SchemaGraph').then((m) => ({ default: m.SchemaGraph })),
);

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ROLES.SUPER_ADMIN);
  const schema = introspectDrizzleSchema();
  const stats = await schemaStats(schema.tables.map((t) => t.id));
  return { schema, stats };
}

export default function DbSchemaPage({ loaderData }: Route.ComponentProps) {
  const { dateTime: formatDateTime } = useTimeFormat();
  const { schema, stats } = loaderData;
  const revalidator = useRevalidator();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [direction, setDirection] = useLocalStorage<Direction>({
    key: 'mk-erd-direction',
    defaultValue: 'LR',
  });
  const [compact, setCompact] = useLocalStorage({ key: 'mk-erd-compact', defaultValue: false });
  const [fitKey, setFitKey] = useState(0);
  const selected = schema.tables.find((t) => t.id === selectedId) ?? null;
  const pending = stats.migrations.pending;

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>DB Schema</Title>
          <Text size="sm" c="dimmed">
            Diagram relasi dari definisi Drizzle, dipadukan dengan jumlah baris dan ukuran nyata di
            database. Statistik {formatDateTime(stats.generatedAt)}.
          </Text>
        </div>
        <Button
          size="sm"
          variant="light"
          leftSection={<FiRefreshCw size={14} />}
          loading={revalidator.state === 'loading'}
          onClick={() => revalidator.revalidate()}
        >
          Muat ulang statistik
        </Button>
      </Group>

      {pending > 0 && (
        <Alert
          color="red"
          variant="light"
          icon={<FiAlertTriangle size={16} />}
          title={`${pending} migrasi belum diterapkan ke database ini`}
        >
          Skema di kode lebih baru daripada database. Jalankan <code>bun run db:migrate</code>{' '}
          sebelum deploy; diagram di bawah menampilkan skema dari kode.
        </Alert>
      )}

      <SchemaStatsCards schema={schema} stats={stats} />

      <SchemaToolbar
        tables={schema.tables}
        selectedId={selectedId}
        onSelect={setSelectedId}
        direction={direction}
        onDirection={setDirection}
        compact={compact}
        onCompact={setCompact}
        onFit={() => setFitKey((k) => k + 1)}
      />

      <Paper
        withBorder
        radius="md"
        style={{ overflow: 'hidden', height: 'min(72vh, 820px)', minHeight: 420 }}
      >
        <Suspense
          fallback={
            <Center h="100%" style={{ gap: 8 }}>
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                Menyiapkan diagram…
              </Text>
            </Center>
          }
        >
          <SchemaGraph
            schema={schema}
            direction={direction}
            compact={compact}
            selectedId={selectedId}
            onSelect={setSelectedId}
            fitKey={fitKey}
          />
        </Suspense>
      </Paper>

      <TableDetailDrawer
        table={selected}
        edges={schema.edges}
        stats={stats.tables.find((t) => t.table === selectedId)}
        onClose={() => setSelectedId(null)}
        onSelect={setSelectedId}
      />
    </Stack>
  );
}
