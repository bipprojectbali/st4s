import { Anchor, Box, Center, Group, MantineProvider, Stack, Text } from '@mantine/core';
import { FiZap } from 'react-icons/fi';
import { Link } from 'react-router';
import { describeError } from '~/lib/error-page';
import { theme } from '~/lib/theme';
import { ErrorPanel } from './ErrorPanel';

type Props = { error: unknown; appName?: string };

/**
 * Standalone error page for the root boundary (no app shell available):
 * brings its own MantineProvider because the boundary renders outside <App />.
 */
export function ErrorPage({ error, appName = 'st4s' }: Props) {
  const info = describeError(error, import.meta.env.DEV);
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Center mih="100vh" p={{ base: 'md', md: 'xl' }}>
        <Stack gap="xl" w="100%" maw={560}>
          <Group justify="center" gap="xs">
            <Anchor component={Link} to="/" c="inherit" underline="never">
              <Group gap={6}>
                <FiZap size={18} />
                <Text fw={700}>{appName}</Text>
              </Group>
            </Anchor>
          </Group>
          <ErrorPanel info={info} />
          <Box ta="center">
            <Text size="xs" c="dimmed">
              Butuh bantuan? Masuk ke akun Anda lalu hubungi admin lewat halaman profil.
            </Text>
          </Box>
        </Stack>
      </Center>
    </MantineProvider>
  );
}
