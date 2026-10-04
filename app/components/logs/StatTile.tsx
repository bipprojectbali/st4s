import { Group, Paper, SimpleGrid, Skeleton, Text, ThemeIcon } from '@mantine/core';
import type { IconType } from 'react-icons';
import { TruncatedText } from './TruncatedText';

export type StatTileProps = {
  label: string;
  value: string;
  hint?: string;
  icon: IconType;
  color?: string;
};

const SKELETON_KEYS = ['s0', 's1', 's2', 's3', 's4', 's5'];

/** One KPI tile: uppercase label, big value, dimmed hint, tinted icon. */
export function StatTile({ label, value, hint, icon: Icon, color = 'blue' }: StatTileProps) {
  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <div style={{ minWidth: 0 }}>
          <TruncatedText size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.3}>
            {label}
          </TruncatedText>
          <Text fz={26} fw={700} lh={1.2} mt={4}>
            {value}
          </Text>
          {hint && (
            <TruncatedText size="xs" c="dimmed" mt={2}>
              {hint}
            </TruncatedText>
          )}
        </div>
        <ThemeIcon variant="light" color={color} size="lg" radius="md" style={{ flexShrink: 0 }}>
          <Icon size={16} />
        </ThemeIcon>
      </Group>
    </Paper>
  );
}

/** Responsive 6-up KPI row; renders skeletons while `tiles` is undefined. */
export function StatTileGrid({ tiles }: { tiles: StatTileProps[] | undefined }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm">
      {tiles
        ? tiles.map((t) => <StatTile key={t.label} {...t} />)
        : SKELETON_KEYS.map((k) => <Skeleton key={k} h={92} radius="md" />)}
    </SimpleGrid>
  );
}
