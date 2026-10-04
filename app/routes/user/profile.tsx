import { Stack, Text, Title } from '@mantine/core';
import { listLogins } from '@server/api/analytics-logins.query';
import { hasGoogleAuth } from '@server/env';
import { requireAnyRole } from '@server/guard';
import { ROLES } from '@server/permissions';
import { useQuery } from '@tanstack/react-query';
import { ApiKeysCard } from '~/components/profile/ApiKeysCard';
import { DangerZoneCard } from '~/components/profile/DangerZoneCard';
import { LinkedAccountsCard } from '~/components/profile/LinkedAccountsCard';
import { LoginHistoryCard } from '~/components/profile/LoginHistoryCard';
import { PasswordCard } from '~/components/profile/PasswordCard';
import { ProfileForm } from '~/components/profile/ProfileForm';
import { ProfileHeader } from '~/components/profile/ProfileHeader';
import { SessionsCard } from '~/components/profile/SessionsCard';
import { useApp } from '~/lib/app-context';
import { authClient, useSession } from '~/lib/auth-client';
import { toJson } from '~/lib/loader-json';
import type { LoginRow } from '~/lib/login-logs-api';
import { type DeviceSession, hasPasswordAccount, type LinkedAccount } from '~/lib/profile-api';
import type { Route } from './+types/profile';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Profile — st4s' }];
}

const HISTORY = 8;

/** Own login history is server-rendered; sessions/accounts come from Better Auth on the client. */
export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireAnyRole(request, [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN]);
  const logins = await listLogins({ userId: user.id, limit: String(HISTORY) });
  return {
    logins: toJson<{ rows: LoginRow[]; total: number }>(logins),
    googleEnabled: hasGoogleAuth,
  };
}

export default function Profile({ loaderData }: Route.ComponentProps) {
  const { user: ctxUser, role } = useApp();
  const { data, refetch: refetchSession } = useSession();
  const user = data?.user ?? ctxUser;
  const currentToken = (data?.session as { token?: string } | undefined)?.token;

  const sessions = useQuery({
    queryKey: ['me-sessions'],
    queryFn: async () => {
      const { data: rows, error } = await authClient.listSessions();
      if (error) throw new Error(error.message ?? 'Gagal memuat sesi');
      return (rows ?? []) as unknown as DeviceSession[];
    },
  });
  const accounts = useQuery({
    queryKey: ['me-accounts'],
    queryFn: async () => {
      const { data: rows, error } = await authClient.listAccounts();
      if (error) throw new Error(error.message ?? 'Gagal memuat akun tertaut');
      return (rows ?? []) as unknown as LinkedAccount[];
    },
  });
  const hasPassword = hasPasswordAccount(accounts.data ?? []);

  return (
    <Stack gap="md" p={{ base: 'sm', md: 'md' }} maw={880}>
      <div>
        <Title order={3}>Profil & keamanan</Title>
        <Text size="sm" c="dimmed">
          Kelola identitas, cara masuk, dan perangkat yang terhubung ke akun Anda.
        </Text>
      </div>
      <ProfileHeader user={user} role={role} />
      <ProfileForm user={user} onSaved={() => refetchSession()} />
      <PasswordCard hasPassword={hasPassword} onChanged={() => sessions.refetch()} />
      <LinkedAccountsCard
        accounts={accounts.data ?? []}
        googleEnabled={loaderData.googleEnabled}
        loading={accounts.isPending}
        onChanged={() => accounts.refetch()}
      />
      <SessionsCard
        sessions={sessions.data ?? []}
        currentToken={currentToken}
        loading={sessions.isPending}
        onChanged={() => sessions.refetch()}
      />
      <ApiKeysCard role={role} />
      <LoginHistoryCard rows={loaderData.logins.rows} total={loaderData.logins.total} />
      <DangerZoneCard email={user.email} hasPassword={hasPassword} />
    </Stack>
  );
}
