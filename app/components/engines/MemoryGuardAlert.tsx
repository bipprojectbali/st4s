import { Alert, Badge, Group, Paper, Stack, Text } from '@mantine/core';
import { FiAlertTriangle, FiShield } from 'react-icons/fi';
import {
  type Guard,
  type GuardThresholds,
  guardNotice,
  guardSummary,
  LEVEL_COLOR,
  LEVEL_TEXT,
} from './guard-notice';

/** Always-visible memory guard summary line, plus an alert while it sheds, recently auto-unloaded, or refused a cold load. */
export function MemoryGuardAlert({
  guard,
  thresholds,
  now,
  dateTime,
}: {
  guard: Guard;
  thresholds: GuardThresholds | null;
  now: number;
  dateTime: (iso: string) => string;
}) {
  const notice = guardNotice(guard, now, dateTime, thresholds);
  return (
    <Stack gap="xs">
      <Paper withBorder radius="md" px="md" py="xs">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Badge
            variant="light"
            color={guard.enabled ? LEVEL_COLOR[guard.level] : 'gray'}
            leftSection={<FiShield size={12} />}
            style={{ flexShrink: 0 }}
          >
            {guard.enabled ? LEVEL_TEXT[guard.level] : 'nonaktif'}
          </Badge>
          <Text size="sm" c="dimmed" style={{ minWidth: 0 }}>
            {guardSummary(guard, thresholds)}
          </Text>
        </Group>
      </Paper>
      {notice && (
        <Alert
          color={notice.color}
          variant="light"
          icon={<FiAlertTriangle size={16} />}
          title={notice.title}
        >
          {notice.lines.map((l) => (
            <Text key={l} size="sm">
              {l}
            </Text>
          ))}
        </Alert>
      )}
    </Stack>
  );
}
