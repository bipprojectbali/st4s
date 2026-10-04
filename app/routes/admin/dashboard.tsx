import { Stack, Text, Title } from '@mantine/core';
import { useApp } from '~/lib/app-context';
import { useSession } from '~/lib/auth-client';

export function meta() {
  return [{ title: 'Dashboard — st4s' }];
}

export default function Dashboard() {
  const { user: ctxUser } = useApp();
  const { data } = useSession();
  const user = data?.user ?? ctxUser;

  return (
    <Stack>
      <Title order={2}>Dashboard</Title>
      <Text>
        Signed in as <b>{user.email}</b>
      </Text>
    </Stack>
  );
}
