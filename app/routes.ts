import { index, layout, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('login', 'routes/login.tsx'),
  // Post-auth resolver: sends a logged-in user to their role's home.
  route('go', 'routes/go.tsx'),
  // Signed-in but banned users land here (see server/guard.ts).
  route('banned', 'routes/banned.tsx'),
  // Strict per-role areas. Each layout guards its role; children inherit it.
  layout('routes/user/layout.tsx', [route('profile', 'routes/user/profile.tsx')]),
  layout('routes/admin/layout.tsx', [route('dashboard', 'routes/admin/dashboard.tsx')]),
  layout('routes/super/layout.tsx', [
    route('dev', 'routes/super/overview.tsx'),
    route('dev/users', 'routes/super/users.tsx'),
    route('dev/sessions', 'routes/super/sessions.tsx'),
    route('dev/posts', 'routes/super/posts.tsx'),
    route('dev/api-keys', 'routes/super/api-keys.tsx'),
    route('dev/db-schema', 'routes/super/db-schema.tsx'),
    route('dev/visits', 'routes/super/visits.tsx'),
    route('dev/login-logs', 'routes/super/login-logs.tsx'),
    route('dev/rate-limit-logs', 'routes/super/rate-limit-logs.tsx'),
    route('dev/settings', 'routes/super/settings.tsx'),
    route('dev/tools', 'routes/super/tools.tsx'),
    route('dev/file-health', 'routes/super/file-health.tsx'),
    route('dev/server-logs', 'routes/super/server-logs.tsx'),
    route('dev/audit', 'routes/super/audit.tsx'),
    route('dev/changelog', 'routes/super/changelog.tsx'),
    route('dev/engines', 'routes/super/engines.tsx'),
    route('dev/playground', 'routes/super/playground.tsx'),
  ]),
] satisfies RouteConfig;
