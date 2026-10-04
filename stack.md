# st4s — Stack (2026)

Status: **scaffolded & verified** (dev + prod build, DB migrations, auth flow all
tested end-to-end). See README.md for usage.

Model arsitektur: **Single-port / satu origin**. Elysia adalah server HTTP
tunggal. `/api/*` ditangani Elysia (API + Better Auth), sisanya (`/*`)
diteruskan ke React Router SSR handler. Komunikasi typesafe via **Eden Treaty**.

```
Bun : Elysia (satu port, mis. :3005)
  /api/auth/* -> Better Auth
  /api/*      -> Elysia API (+ Eden)
  /assets/*   -> static build Vite (prod)
  /*          -> React Router SSR
```

Alasan satu origin: tanpa CORS, cookie session Better Auth mulus, deploy
sederhana (satu proses). Development: Vite middleware mode di dalam server
→ tetap satu port + HMR.

## Core Stack (versi terpasang)

| Layer | Pilihan | Versi |
|---|---|---|
| Runtime | Bun | 1.4.2 |
| Backend | Elysia + Eden Treaty | 1.4.x |
| ORM | Drizzle ORM + drizzle-kit | 0.45 / 0.31 |
| Database | PostgreSQL (pgvector/pg16, shared infra-postgres) | 16 |
| Auth | Better Auth (adapter Drizzle, email+password) | 1.7.x |
| Frontend | React Router (SSR) + React | 8.3 / 19.2 |
| UI Kit | Mantine + @mantine/form | 9.6 |
| Data fetching | TanStack Query | 5.x |
| Client state | Zustand | 5.x |
| Validation | TypeBox (API) + Zod (env/shared) | 0.34 / 4.x |
| Tooling | Biome, Pino, TypeScript, Vite | 2.5 / 10 / 7 / 8 |

## Catatan Keputusan

- **TanStack Query vs TanStack Router**: produk terpisah. Pakai Query untuk data,
  tetap React Router untuk routing + SSR.
- **Database**: memakai instance Postgres yang sudah berjalan (`infra-postgres`,
  user `bip`), database `makuro`. `docker-compose.yml` menyediakan Postgres lokal
  opsional via profil: `docker compose --profile local-db up -d`.
- **Port**: default 3005 karena :3000 dipakai container lain di mesin ini.
- **SSR di Bun**: import `react-dom/server.node` (bukan bare `react-dom/server`)
  karena bare specifier resolve ke build web-streams tanpa
  `renderToPipeableStream`.

## Referensi

- Elysia fullstack example: https://github.com/SaltyAom/elysia-fullstack-example
- Drizzle ORM: https://github.com/drizzle-team/drizzle-orm
- Better Auth: https://github.com/better-auth/better-auth
- React Router: https://github.com/remix-run/react-router
- Mantine: https://github.com/mantinedev/mantine

## Kandidat berikutnya (belum diputuskan)

- Email provider (Resend) — untuk verifikasi email & reset password Better Auth
- Testing (Vitest / bun test + Playwright)
- Monorepo (Turborepo) — jika nanti butuh split packages
- Ops lanjutan: GitHub Actions CI, Sentry, rate limit
