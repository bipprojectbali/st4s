import { ActionIcon, CopyButton, Group, Stack, Text, Tooltip } from '@mantine/core';
import { FiCheck, FiCopy } from 'react-icons/fi';
import { TruncatedText } from './TruncatedText';

/** Label/value row used inside detail drawers. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
      <Text size="sm" c="dimmed" style={{ flexShrink: 0, width: 110 }}>
        {label}
      </Text>
      <div style={{ minWidth: 0, flex: 1, textAlign: 'right' }}>{children}</div>
    </Group>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.3}>
        {title}
      </Text>
      {children}
    </Stack>
  );
}

/** Monospace value with a copy-to-clipboard button. */
export function Copyable({ value }: { value: string }) {
  return (
    <Group gap={4} wrap="nowrap" justify="flex-end">
      <TruncatedText ff="monospace" size="sm" style={{ minWidth: 0 }}>
        {value}
      </TruncatedText>
      <CopyButton value={value} timeout={1500}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Tersalin' : 'Salin'} withArrow>
            <ActionIcon
              variant="subtle"
              color={copied ? 'teal' : 'gray'}
              size="sm"
              onClick={copy}
              aria-label="Salin"
            >
              {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}
