import { Group, Paper, SimpleGrid, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import type { IconType } from 'react-icons';
import {
  FiCpu,
  FiDatabase,
  FiFileText,
  FiKey,
  FiList,
  FiLogIn,
  FiMic,
  FiSettings,
  FiShield,
  FiTag,
  FiUsers,
} from 'react-icons/fi';
import { Link } from 'react-router';

const LINKS: Array<{
  to: string;
  label: string;
  description: string;
  icon: IconType;
  color: string;
}> = [
  {
    to: '/dev/users',
    label: 'Users',
    description: 'Role, ban, impersonasi',
    icon: FiUsers,
    color: 'blue',
  },
  {
    to: '/dev/api-keys',
    label: 'API Keys',
    description: 'Scope, rotasi, pemakaian',
    icon: FiKey,
    color: 'indigo',
  },
  {
    to: '/dev/visits',
    label: 'Visitor Logs',
    description: 'Kunjungan, lokasi, perangkat',
    icon: FiList,
    color: 'cyan',
  },
  {
    to: '/dev/login-logs',
    label: 'Login Logs',
    description: 'Siapa masuk dan dari mana',
    icon: FiLogIn,
    color: 'teal',
  },
  {
    to: '/dev/rate-limit-logs',
    label: 'Rate Limits',
    description: 'Request yang ditolak',
    icon: FiShield,
    color: 'orange',
  },
  {
    to: '/dev/file-health',
    label: 'File Health',
    description: 'Ukuran file, risiko konteks agent',
    icon: FiFileText,
    color: 'yellow',
  },
  {
    to: '/dev/db-schema',
    label: 'DB Schema',
    description: 'Diagram tabel dan relasi',
    icon: FiDatabase,
    color: 'grape',
  },
  {
    to: '/dev/engines',
    label: 'Engines',
    description: 'Status model, warmup, unload',
    icon: FiCpu,
    color: 'violet',
  },
  {
    to: '/dev/playground',
    label: 'Playground',
    description: 'Coba STT dan TTS langsung',
    icon: FiMic,
    color: 'pink',
  },
  {
    to: '/dev/changelog',
    label: 'Changelog',
    description: 'Riwayat perubahan per versi',
    icon: FiTag,
    color: 'teal',
  },
  {
    to: '/dev/settings',
    label: 'Settings',
    description: 'Autentikasi, rate limit, runtime',
    icon: FiSettings,
    color: 'gray',
  },
];

/** Card grid to every console section (keyboard/touch friendly). */
export function QuickLinks() {
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
      {LINKS.map((l) => (
        <UnstyledButton
          key={l.to}
          component={Link}
          to={l.to}
          prefetch="intent"
          aria-label={l.label}
        >
          <Paper withBorder radius="md" p="md" h="100%">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon variant="light" color={l.color} size="lg" radius="md">
                <l.icon size={16} />
              </ThemeIcon>
              <div style={{ minWidth: 0 }}>
                <Text fw={600} size="sm" lh={1.2}>
                  {l.label}
                </Text>
                <Text size="xs" c="dimmed" lh={1.2}>
                  {l.description}
                </Text>
              </div>
            </Group>
          </Paper>
        </UnstyledButton>
      ))}
    </SimpleGrid>
  );
}
