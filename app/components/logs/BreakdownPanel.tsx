import { Group, Paper, Progress, Stack, Text, UnstyledButton } from '@mantine/core';
import { percent } from '~/lib/visits-format';
import { TruncatedText } from './TruncatedText';

export type BreakdownItem = { key: string | null; count: number };

const nf = new Intl.NumberFormat('id-ID');

type RowProps = {
  label: string;
  count: number;
  pct: number;
  mono?: boolean;
  onClick?: () => void;
  ariaLabel: string;
};

function BreakdownRow({ label, count, pct, mono, onClick, ariaLabel }: RowProps) {
  const body = (
    <Stack gap={4} style={{ width: '100%' }}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <TruncatedText size="sm" ff={mono ? 'monospace' : undefined} style={{ minWidth: 0 }}>
          {label}
        </TruncatedText>
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {nf.format(count)} · {pct}%
        </Text>
      </Group>
      <Progress value={pct} size="xs" radius="xl" />
    </Stack>
  );
  if (!onClick) return <div>{body}</div>;
  return (
    <UnstyledButton
      onClick={onClick}
      aria-label={ariaLabel}
      style={{ display: 'block', width: '100%' }}
    >
      {body}
    </UnstyledButton>
  );
}

export type BreakdownPanelProps = {
  title: string;
  items: BreakdownItem[];
  total: number;
  render: (key: string | null) => string;
  onSelect?: (key: string) => void;
  mono?: boolean;
  emptyText?: string;
};

/** Top-N list with share bars. Rows become buttons when `onSelect` is given. */
export function BreakdownPanel({
  title,
  items,
  total,
  render,
  onSelect,
  mono,
  emptyText,
}: BreakdownPanelProps) {
  return (
    <Paper withBorder radius="md" p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.3} mb="sm">
        {title}
      </Text>
      {items.length === 0 ? (
        <Text size="sm" c="dimmed">
          {emptyText ?? 'Belum ada data.'}
        </Text>
      ) : (
        <Stack gap="xs">
          {items.map((it) => {
            const key = it.key;
            return (
              <BreakdownRow
                key={key ?? 'null'}
                label={render(key)}
                count={it.count}
                pct={percent(it.count, total)}
                mono={mono}
                onClick={onSelect && key ? () => onSelect(key) : undefined}
                ariaLabel={`Filter ${title}: ${render(key)}`}
              />
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}
