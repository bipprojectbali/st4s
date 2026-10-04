# Makuro ⚡

Fullstack template dengan **satu port, tanpa CORS, siap production**. Frontend dan backend berjalan dalam satu proses Elysia — tidak ada proxy, tidak ada CORS config, cookies langsung bekerja.

```
Browser  →  Bun/Node :3005
              /api/auth/*  →  Better Auth
              /api/*       →  Elysia API (Eden Treaty)
              /assets/*    →  static Vite (immutable, prod)
              /*           →  React Router v8 SSR
```

## Untuk AI agent

Dokumentasi ini adalah satu-satunya sumber dan bisa dibaca tanpa JavaScript:

- `GET /README.md` — file ini apa adanya (`text/markdown`), juga `/llms-full.txt` (`text/plain`).
- `GET /llms.txt` — indeks singkat (judul, ringkasan, daftar bagian, endpoint untuk agent), dibangkitkan dari heading README.
- `GET /api/version` — `{ name, version, env, bun }`, publik.
- API dipakai dengan header `X-API-Key: mk_live_…` atau `Authorization: Bearer mk_live_…`; scope per route ada di bagian **API keys**. Semua error API berbentuk JSON `{ error, code, status, requestId }`.
- Server MCP di `/api/mcp` (Streamable HTTP) menerima API key ber-scope `mcp`; katalog tool ada di bagian **Dev console → Tools & MCP**.
- Speech-to-text dan text-to-speech kompatibel OpenAI ada di `/api/v1` (`baseURL: <host>/api/v1` di SDK `openai`); error di bawah `/api/v1` berbentuk OpenAI `{ error: { message, type, param, code } }`. Lihat bagian **Speech API (kompatibel OpenAI)**.

Untuk mesin pencari: `/robots.txt` (area login, konsol, dan API ditutup) dan `/sitemap.xml` dibangun dari `APP_URL`, sedangkan landing punya meta Open Graph/Twitter, `og:image` (`/og.png`, 1200×630), dan `canonical` — jadi set `APP_URL` ke origin publik di produksi.

Ketiga URL dokumentasi dilayani sebelum SSR, ber-ETag (`304` bila tidak berubah), tidak dihitung sebagai kunjungan, dan tetap tersedia saat mode maintenance.

## Apa yang sudah ada

| Fitur | Detail |
|---|---|
| **Single-port** | API + SSR dalam satu Elysia server, dev dan prod identik |
| **Type safety end-to-end** | Eden Treaty: tipe client diekstrak dari route Elysia, tanpa codegen |
| **Auth lengkap** | Better Auth: Google OAuth, email+password, multi-session, sistem role |
| **SSR tanpa waterfall** | React Router v8 loader berjalan server-side, session tersedia di loader |
| **ORM type-safe** | Drizzle ORM + PostgreSQL, schema-as-code, migration files, Drizzle Studio |
| **UI kit terkonfigurasi** | Mantine v9, TanStack Query, Zustand, Biome — semua sudah terhubung |
| **Dev console `/dev`** | 17 halaman operasional: users, sessions, posts, API keys, DB schema, log pengunjung/login/rate-limit/server/audit, file health, engines, playground, tools, settings — badge hidup di sidebar |
| **API keys** | Kunci `mk_live_…` ber-scope, kedaluwarsa, rotasi dengan masa tenggang, IP allow-list, rate limit per kunci, jejak pemakaian + rollup harian, kunci pribadi per user |
| **Observability** | Visitor/login/rate-limit log dengan geo & perangkat, audit trail semua aksi admin, buffer log server, retensi otomatis, mode maintenance, feature flags |
| **Error yang konsisten** | Halaman 404/401/403/5xx bermerek (sidebar tetap tampil di konsol), error API selalu `{ error, code, status, requestId }`, fallback HTML bila SSR gagal |
| **Speech server** | `/api/v1` kompatibel SDK `openai`: transkripsi (Qwen3-ASR) dan sintesis suara (Supertonic 3) lokal, keduanya streaming, engine di child process |
| **Ramah AI agent** | `/README.md` + `/llms.txt` teks polos, server MCP ber-API-key, tool file health agar konteks agent tidak meledak |

## Stack

| Layer | Tech | Versi |
|---|---|---|
| Runtime | Bun | 1.4.x |
| Backend | Elysia + Eden Treaty | 1.4.x |
| Auth | Better Auth (Drizzle adapter) | 1.7.x |
| ORM / DB | Drizzle ORM + PostgreSQL | 0.45 / PG 16 |
| Frontend | React Router v8 SSR + React | 8.x / 19.x |
| UI | Mantine + @mantine/form | 9.6.x |
| Data fetching | TanStack Query | 5.x |
| Client state | Zustand | 5.x |
| Validation | TypeBox (API) + Zod (env) | 0.34 / 4.x |
| Tooling | Biome, Pino, TypeScript, Vite | 2.5 / 10 / 7 / 8 |

## Quick start

```bash
# 1. Install
bun install

# 2. Konfigurasi env
cp .env.example .env
# Wajib: DATABASE_URL, BETTER_AUTH_SECRET (openssl rand -base64 32)
# Opsional: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

# 3. Buat database dan jalankan migrasi
# Opsi A — pakai Postgres yang sudah ada:
#   psql -c "CREATE DATABASE makuro;"
# Opsi B — spin up lokal dengan Docker:
#   docker compose --profile local-db up -d
bun run db:migrate

# 4. Dev server (single port, HMR)
bun run dev   # → http://localhost:3005

# 5. Production
bun run build
bun run start
```

## Scripts

| Script | Fungsi |
|---|---|
| `bun run dev` | Dev server satu port (Elysia + Vite HMR + RR SSR) |
| `bun run build` | Build client + server bundle |
| `bun run start` | Production server (`server/prod.ts`, NODE_ENV=production) |
| `bun run smoke:prod` | Build lalu boot `server/prod.ts` di port bebas dan jalankan 22 pemeriksaan black-box (`scripts/smoke-server.ts`) |
| `bun run smoke:binary` | Sama, tetapi terhadap binary hasil `build:binary` |
| `bun run build:binary` | Build binary native (platform saat ini) |
| `bun run build:binary:linux` | Cross-compile ke Linux x64 glibc |
| `bun run build:binary:linux-musl` | Cross-compile ke Linux x64 musl (Alpine/Docker) |
| `bun run typecheck` | `react-router typegen` + `tsc --noEmit` |
| `bun run lint` | Biome check |
| `bun run format` | Biome format --write |
| `bun run db:generate` | Generate SQL migration dari Drizzle schema |
| `bun run db:migrate` | Apply migration |
| `bun run db:push` | Push schema langsung (interaktif) |
| `bun run db:studio` | Drizzle Studio |
| `bun run admin:verify <email>` | Tandai email user di `SUPER_ADMIN_EMAILS` sebagai terverifikasi (bootstrap super-admin tanpa Google) |
| `bun run test` | Test suite (bun:test, `tests/`, pakai DATABASE_URL_TEST) |

## Binary distribution (tanpa Bun di server)

```bash
# Build binary untuk platform saat ini
bun run build:binary          # → ./makuro

# Cross-compile ke Linux (dari Mac atau mana saja)
bun run build:binary:linux      # → ./makuro-linux-x64     (Ubuntu/Debian)
bun run build:binary:linux-musl # → ./makuro-linux-musl    (Alpine, Docker)

# Jalankan di server — satu file, tanpa perlu install Bun atau build/ folder
./makuro-linux-x64
```

**Satu file, tidak ada dependensi eksternal:**

```
makuro-linux-x64   ← binary ~130 MB — semua embedded:
                     • Bun runtime (JavaScriptCore)
                     • Server code (Elysia, Better Auth, Drizzle)
                     • React Router SSR bundle
                     • Seluruh static assets (CSS, JS, favicon, dll)
```

Seperti Go binary: copy satu file ke server, langsung jalan. Tidak perlu `build/`, tidak perlu Node/Bun, tidak perlu `npm install`.

**Verifikasi sebelum deploy:** `bun run smoke:binary` membangun binary, menjalankannya di port acak dengan `NODE_ENV=production`, lalu memeriksa versi, SSR landing/login, redirect guard, favicon, probe, halaman 404, JSON 404 API, Better Auth, penolakan API key palsu dan MCP anonim, `/README.md`, `/llms.txt`, meta OG landing, `/robots.txt`, `/sitemap.xml`, gambar OG, apple-touch-icon, header rate limit, dan aset client ber-cache immutable. `bun run smoke:prod` melakukan hal yang sama untuk mode skrip (`bun run start`). Keduanya keluar dengan kode ≠ 0 bila ada yang gagal.

**NODE_ENV:** binary men-default `NODE_ENV=production`, tetapi Bun otomatis memuat `.env` dari direktori kerja — bila file itu berisi `NODE_ENV=development`, binary berjalan dalam mode development (detail error API terbuka, tanpa log file) dan mencetak peringatan saat start. Di server, gunakan `.env` tanpa `NODE_ENV` atau set `production`.

> **Teknik:** SSR bundle di-embed via static `import * as ssrBuild from '../build/server/index.js'` — Bun bundler mengikuti static import dan mem-bundle seluruh dependensi (`@react-router/node`, `react-dom`, dll) ke dalam binary. `--asset ./build/client` embed seluruh direktori client ke VFS (tersedia di runtime sebagai `client/` — satu level parent directory di-strip). `inlineDynamicImports: true` di Vite memastikan SSR bundle adalah satu file tunggal tanpa dynamic chunk splits.

**Engine suara di binary:** model, `libcrispasr`, dan ffmpeg **tidak** di-embed — binary membacanya dari path di env (lihat bagian **Speech API**). Binary menjalankan engine dengan me-re-exec dirinya sendiri sebagai `--s4s-engine-child stt|tts`, jadi tidak butuh Bun di server. STT jalan apa adanya. TTS butuh `libonnxruntime.1.dylib` (dari `node_modules/onnxruntime-node/bin/napi-v6/<os>/<arch>/`) diletakkan di samping binary dan direktorinya diset di `DYLD_LIBRARY_PATH` — `bun build --compile` meng-embed `onnxruntime_binding.node` tetapi tidak library dinamisnya. Di Linux padanannya `libonnxruntime.so.1` + `LD_LIBRARY_PATH` (belum dites).

> **Catatan:** Binary lebih besar (~130 MB) karena embed Bun runtime (JavaScriptCore). Trade-off yang sama dengan semua single-binary JS runtimes (Deno, Node SEA).

## Struktur project

```
app/                    React Router app (SSR)
  root.tsx              Provider (Mantine, TanStack Query, Modals) + ErrorBoundary root
  entry.server.tsx      Streaming SSR + handleError (404 senyap, sisanya ke pino)
  routes.ts             Konfigurasi route (per-role layout guards)
  routes/
    home.tsx            Landing page (angka hidup dari server/landing-stats.ts)
    login.tsx  go.tsx   Login/signup, post-auth resolver ke home role
    user/  admin/       Area /profile dan /dashboard (layout + ErrorBoundary ber-sidebar)
    super/              Area /dev: 17 halaman konsol super-admin
  components/
    AppFrame.tsx frame/ Shell sidebar (nav model, badge, brand header)
    errors/             ErrorPage (standalone), ErrorPanel, AreaErrorBoundary
    logs/               Komponen bersama halaman log: StatTile, BreakdownPanel, LogCells, DetailParts
    api-keys/ users/ sessions/ posts/ settings/ profile/ … komponen per halaman
  lib/                  Klien API bertipe per domain (*-api.ts), error-page.ts, theme, query
server/
  env.ts                Env vars divalidasi Zod
  auth.ts               Better Auth (Drizzle adapter, admin + apiKey plugin)
  guard.ts              requireRole / requireAnyRole / resolveActor (sesi atau API key)
  permissions.ts roles  ROLES, homeFor(role), rekonsiliasi super-admin dari env
  api/
    index.ts            Elysia app: error plugin → rate limit → maintenance → api key → router
    *.ts  *.query.ts    Route handler (≤150 baris) dan query per domain
  api-keys/             scopes, plugin (onRequest), service/query, usage + rollup harian
  api-error.ts          Bentuk JSON error seragam + requestId
  error-page.ts         HTML fallback 500/503 tanpa React
  readme.ts             /README.md, /llms.txt, /llms-full.txt dari satu sumber
  http-probes.ts        favicon.ico, .well-known, apple-touch-icon sebelum SSR
  seo.ts                /robots.txt dan /sitemap.xml dari APP_URL sebelum SSR
  sidebar-badges.ts     Counter badge sidebar /dev (cache 15 dtk)
  settings*.ts          app_setting: auth, rate limit, retensi, maintenance, flags, branding
  middleware/           client-ip, visitor (+geo, UA), rate-limiter, maintenance
  mcp/                  Server MCP + tool (status, log, DB, file health)
  v1/                   API audio kompatibel OpenAI (/api/v1: models, transcriptions, speech)
  engines/              Engine STT/TTS (kontrak, registry, child process, boot/shutdown)
  file-health/          Pemindai ukuran file / risiko konteks agent
  db/
    schema.*.ts         Drizzle schema per concern (auth, app, logs, keys)
    migrations/         SQL migration idempotent (0001…0012)
  http-bridge.ts        Node ↔ Fetch Request/Response bridge
  dev.ts  prod.ts       Dev server (Vite middleware) dan Bun.serve produksi
tests/                  bun:test, mirror struktur server/ (DATABASE_URL_TEST)
```

## Cara single-port bekerja

**Dev** (`server/dev.ts`): Node `http` server di satu port. `/api/*` ke Elysia; sisanya ke Vite dev middleware (assets + HMR), lalu ke React Router SSR handler (`virtual:react-router/server-build`).

**Prod** (`server/prod.ts`): `Bun.serve` di satu port. `/api/*` → Elysia, static assets dari `build/client` dengan immutable cache, sisanya → compiled React Router server build.

Karena FE dan BE satu origin: Eden client dan Better Auth client pakai relative URL — tanpa CORS, cookies langsung bekerja.

## Auth & roles

Sistem role: `user` → `admin` → `super-admin`. Role tersimpan di tabel `user` via Better Auth admin plugin.

| Role | Home | Area |
|---|---|---|
| `user` | `/profile` | Profil, keamanan akun, sesi perangkat, API key pribadi |
| `admin` | `/dashboard` | Dashboard, manajemen user (ban, role change), API key pribadi |
| `super-admin` | `/dev` | Overview, users, sessions, posts, DB schema, visitor/login/rate-limit/server/audit logs, file health, tools & MCP, settings |

Google OAuth: set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Authorized redirect URI di Google Console: `${BETTER_AUTH_URL}/api/auth/callback/google`.

**Super-admin & sign-up di produksi.** Role `super-admin` dari `SUPER_ADMIN_EMAILS` hanya diberikan ke email yang **terverifikasi**. Template ini tidak mengirim email verifikasi, jadi di produksi super-admin masuk lewat Google, atau operator menjalankan `bun run admin:verify <email>` (lihat checklist di bawah). Sign-up email+password tertutup saat `NODE_ENV=production` (termasuk binary) kecuali `AUTH_DISABLE_SIGNUP=false` (kosong = belum di-set); login user lama dan Google OAuth tetap jalan.

**Toggle "Login email" & "Pendaftaran" di `/dev/settings` ditegakkan server.** `POST /api/auth/sign-in/email` dan `/sign-up/email` yang dinonaktifkan dijawab `403` (`EMAIL_AUTH_DISABLED` / `SIGNUP_DISABLED`) dengan pesan bahasa Indonesia; Google tidak terpengaruh. Aturan efektifnya (satu helper `server/settings-auth.ts`, dipakai hook auth dan halaman login):

- Login email aktif bila toggle "Login email" menyala **atau Google tidak dikonfigurasi** — tanpa Google, email adalah satu-satunya jalan masuk sehingga tidak bisa dimatikan.
- Sign-up aktif bila login email aktif **dan** toggle "Pendaftaran" menyala **dan** sign-up tidak ditutup env (`AUTH_DISABLE_SIGNUP`).

**Checklist deploy (production)**

1. `bun run db:migrate` terhadap database produksi.
2. Set `SUPER_ADMIN_EMAILS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.
3. Bootstrap super-admin — pilih satu:
   - Google: set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, lalu login Google dengan email di `SUPER_ADMIN_EMAILS`.
   - Tanpa Google: jalankan sementara dengan `AUTH_DISABLE_SIGNUP=false`, daftar dengan email itu, jalankan `bun run admin:verify <email>` (menolak email di luar allowlist / user yang belum ada; output hanya email ter-mask), lalu kosongkan lagi `AUTH_DISABLE_SIGNUP` dan restart.
4. Speech: `FFMPEG_PATH`, `CRISPASR_LIB`, `STT_MODEL`, `TTS_MODEL_DIR` (lihat **Speech API**).
5. Binary: letakkan `libonnxruntime.1.dylib` di samping binary dan set `DYLD_LIBRARY_PATH` (Linux: `libonnxruntime.so.1` + `LD_LIBRARY_PATH`) agar TTS jalan.
6. Di belakang reverse proxy (nginx/caddy): set `TRUSTED_PROXIES` (mis. `loopback` bila proxy di host yang sama, atau IP/CIDR proxy). Tanpa itu `X-Forwarded-For` diabaikan dan semua klien terlihat ber-IP proxy (satu bucket rate limit). Proxy juga harus membiarkan respons yang lama diam: transkripsi panjang dan antrean engine bisa tidak mengirim byte selama beberapa menit. Untuk nginx di `/api/v1/audio/` dan `/api/engines/`: `proxy_read_timeout 1800s;` dan `proxy_buffering off;` (SSE). Server sendiri menutup koneksi diam setelah 60 dtk kecuali di dua prefix itu, dan menolak body > `V1_MAX_UPLOAD_MB` + 1 MiB dengan 413 sebelum mem-buffer.

**Ban & hapus akun — apa yang dilihat user.** Better Auth sendiri hanya menolak *pembuatan sesi baru* untuk user yang diblokir; template ini melengkapinya:

- Saat admin memblokir (`POST /api/admin/users/:id/ban`), semua sesi aktif user itu dicabut seketika (tercatat di audit). Request berikutnya dari perangkat user diarahkan ke `/login?notice=session` dengan pesan bahwa sesi berakhir.
- Bila user yang diblokir masih memegang sesi (misalnya diblokir lewat jalur lain), guard (`server/guard.ts`) menolaknya dan mengarahkan ke **`/banned`**: halaman yang menampilkan alasan, apakah permanen atau sampai kapan (dengan hitung mundur), langkah yang bisa dilakukan, tautan dukungan dari branding, tombol keluar, dan ke beranda. Ban yang sudah lewat waktunya diperlakukan sebagai dicabut.
- Saat mencoba masuk lagi, halaman login menerjemahkan kode Better Auth (`BANNED_USER`, `INVALID_EMAIL_OR_PASSWORD`, `USER_NOT_FOUND`, …) ke pesan bahasa Indonesia yang actionable; login Google yang ditolak kembali ke `/login?error=<kode>` (bukan halaman error mentah Better Auth) berkat `errorCallbackURL`.
- User yang **dihapus permanen** kehilangan sesinya (cascade), sehingga perangkatnya mendapat notice "sesi berakhir" di login; mencoba masuk dengan email lama menghasilkan "akun tidak ditemukan", dan login Google akan membuat akun baru yang bersih. Tidak ada jejak yang disimpan tentang akun yang dihapus (selain audit log admin).

## Visitor analytics

Setiap page navigation (bukan `/api/*`, aset, atau loader `.data`) dicatat ke `visit_log` oleh `server/middleware/visitor.ts` dan ditampilkan di `/dev/visits` (super-admin): statistik, breakdown negara/perangkat/browser/OS/halaman/referer, filter, detail per kunjungan, hapus massal, dan export CSV.

Data yang dikumpulkan per kunjungan: IP, path, referer (query string dibuang), user login, tipe bot (`isbot`), browser/OS/versi dan jenis perangkat (parser in-house + Client Hints di `visitor-ua.ts`), bahasa (`Accept-Language`), serta negara/wilayah/kota.

**Negara & kota dibaca dari header proxy** — tidak ada database GeoIP atau lookup pihak ketiga. Pastikan app berjalan di belakang salah satu:

| Proxy | Header yang dibaca |
|---|---|
| Cloudflare | `CF-IPCountry` (default), `CF-Region-Code`, `CF-IPCity` (aktifkan *Managed Transforms → Add visitor location headers*) |
| Vercel | `X-Vercel-IP-Country`, `X-Vercel-IP-Country-Region`, `X-Vercel-IP-City` |
| CloudFront | `CloudFront-Viewer-Country`, `-Country-Region`, `-City` |
| nginx + geoip2 | `X-Country-Code`, `X-Region`, `X-City` |

Tanpa header tersebut kolom geo bernilai `null`; UI menampilkan "Lokal" untuk IP privat/loopback dan "Tidak diketahui" untuk sisanya.

Login log (`/dev/login-logs`) memakai enrichment yang sama plus kolom `method` (email / provider OAuth / impersonation / switch) dari endpoint Better Auth yang membuat sesi; API `/api/analytics/login-logs` punya bentuk yang sama (`search`, `country`, `device`, `method`, `userId`, `days`, `/stats`, `/export`, `DELETE` massal).

API (`/api/analytics/visits`, super-admin): `GET` list dengan query `page`, `limit`, `sort`, `search`, `type=human|bot`, `country`, `device`, `browser`, `os`, `days`; `GET /stats`; `GET /export` (CSV, maks. 10.000 baris, filter sama); `DELETE /:id`; `DELETE` body `{ ids: string[] }` (maks. 100).

## Dev console (`/dev`)

Konsol super-admin dengan pola yang sama di tiap halaman: loader SSR (data lengkap di paint pertama), KPI, filter, tabel + kartu mobile, drawer detail, konfirmasi aksi destruktif, notifikasi, dan audit.

- **Overview** — angka utama, peringatan (maintenance, retensi belum diatur, user banned, API key hampir kedaluwarsa, file berbahaya), aktivitas terbaru.
- **Sidebar** — tiap menu punya badge hidup dari `server/sidebar-badges.ts` (cache 15 detik, gagal lunak): nada *perhatian* berwarna (user diblokir, impersonasi aktif, migrasi tertunda, request diblokir, error server, kunci hampir habis, masalah konfigurasi) atau nada *informasi* abu-abu (jumlah user, sesi aktif, kunjungan/login/aksi 24 jam). Hover menampilkan fungsi menu dan arti angkanya.
- **Kelola**: Users (role, ban dengan alasan/durasi, impersonasi, hapus), Sessions (cabut sesi lintas user), Posts (konten contoh; pemilik atau admin), API Keys (lihat bagian di bawah), DB Schema (ERD + statistik nyata + status migrasi).
- **Log & monitoring**: Visitor Logs, Login Logs, Rate Limits, Server Logs (buffer pino di memori, `GET /api/logs`; live lewat SSE `GET /api/logs/stream`, resume via `Last-Event-ID`), Audit Log (`audit_log`: semua aksi berhak istimewa, read-only, `GET /api/audit`), File Health.
- **Tools & MCP**: status proses, katalog tool MCP + contoh `.mcp.json` (auth lewat API key ber-scope `mcp`, tombol "Buat kunci MCP"), ringkasan API, reset cache/limiter (`POST /api/ops/reset/:target`, teraudit).
- **Changelog** — `CHANGELOG.md` (Keep a Changelog) dirender sebagai timeline per versi dengan filter jenis dan pencarian. Badge sidebar kuning bila versi di `package.json` belum punya entry, abu-abu untuk jumlah perubahan di `[Unreleased]`. Dev membaca file langsung; `bun run start`/binary memakai salinan yang ter-embed saat build.
- **Settings** (`app_setting`, semua perubahan teraudit): autentikasi, rate limit, **retensi log** (usia maksimum per tabel, job harian + jalankan manual), **mode maintenance** (503 untuk semua kecuali role yang diizinkan; login tetap terbuka), **feature flags** (`isFeatureEnabled(key)` di server, `GET /api/settings` → `features` di client), **branding** (nama, tagline, URL dukungan → sidebar, meta, login).

Migrasi yang dibutuhkan fitur-fitur ini: 0008 (audit_log), 0009 (settings), 0010 (post.updated_at), 0011 (apikey, api_key_usage), 0012 (api_key_usage_daily) — semuanya idempotent.

Menambah halaman `/dev` baru berarti menyentuh lima tempat sekaligus: `app/routes.ts`, `NAV` di `app/routes/super/layout.tsx`, `QuickLinks` overview, `CONSOLE_PAGES` di landing (test menjaga jumlahnya sama dengan route), dan badge di `server/sidebar-badges.ts`.

## Halaman & respons error

Semua kegagalan punya wajah yang konsisten, di UI maupun API:

- **Halaman** — `ErrorBoundary` root (`app/components/errors/ErrorPage.tsx`) merender 404/401/403/5xx dengan judul, penjelasan, langkah berikutnya, path, kode referensi, dan aksi yang relevan (kembali, muat ulang, beranda, masuk). Di dalam area ber-sidebar (`/dev`, `/dashboard`, `/profile`) halaman yang gagal tetap menampilkan sidebar (boundary di tiap layout). Detail teknis hanya tampil di development. Judul tab ikut kode status (`404 Halaman tidak ditemukan — Makuro`) dan `noindex`.
- **API** — `server/api-error.ts` menyeragamkan semua error `/api/*` menjadi `{ error, code, status, requestId, method, path }`: 404 JSON untuk route/method tak dikenal (termasuk yang tadinya ditelan mount Better Auth), 422 dengan `issues[{ path, message }]` untuk validasi (tanpa dump skema), 400 body tak terbaca, 500 dengan pesan generik di produksi. Setiap 5xx dicatat sekali ke log dengan `requestId` yang sama seperti header `X-Request-Id`, jadi laporan user bisa langsung dicocokkan.
- **Fallback tanpa React** — bila SSR sendiri gagal, `server/error-page.ts` mengirim HTML statis (500/503, dark-mode aware, dengan kode referensi) baik di dev maupun prod; halaman pemeliharaan (503) memakai pola yang sama.

## Versi

Versi aplikasi punya satu sumber: `version` di `package.json` (dibaca `server/app-info.ts`). Nilai yang sama tampil di header sidebar konsol, halaman Tools, statistik landing, dan `GET /api/version` (publik, tanpa auth) yang mengembalikan `{ name, version, env, bun }` — cocok untuk probe deploy/uptime. Naikkan versi lewat `package.json` saja.

## API keys

Akses terprogram ke `/api/*` tanpa cookie sesi. Dikelola super-admin di `/dev/api-keys`; dibangun di atas plugin `@better-auth/api-key` (kunci di-hash, hanya prefix yang disimpan terbaca).

- **Format & header** — kunci `mk_live_…`, dikirim lewat `X-API-Key: <key>` atau `Authorization: Bearer <key>`. Nilai asli hanya ditampilkan **sekali** saat dibuat/dirotasi.
- **Scope** — tiap route memetakan ke satu scope (`server/api-keys/scopes.ts`, mis. `users:read`, `analytics:write`, `me:read`). Kunci tidak pernah melebihi role pemiliknya: scope di atas role ditolak saat dibuat, dan jika role pemilik turun belakangan request mendapat `403 ROLE_TOO_LOW`. Route auth dan manajemen kunci tidak bisa diakses dengan kunci; MCP butuh scope `mcp`.
- **Kedaluwarsa & rotasi** — default 90 hari, maksimum 1 tahun; tanpa kedaluwarsa hanya untuk pemilik super-admin. Rotasi membuat kunci baru dengan pengaturan sama dan memberi kunci lama masa tenggang 24 jam. Cabut = permanen tapi riwayat tetap; hapus = baris dan riwayatnya hilang.
- **Pembatasan** — rate limit per kunci (opsional, `429 RATE_LIMITED`), daftar IP/prefix yang diizinkan (`403 IP_NOT_ALLOWED`), nonaktifkan sementara (`401 KEY_DISABLED`).
- **Jejak pemakaian** — tiap request dicatat ke `api_key_usage` (method, path, status, IP, negara, UA, durasi) secara batch, lalu digulung per hari ke `api_key_usage_daily` (job tiap jam, upsert monoton) sehingga grafik 90 hari dan total seumur kunci tetap murah dan tidak hilang saat retensi menghapus baris mentah. Halaman detail menampilkan total, harian 90 hari, endpoint/IP/negara tersering, request terakhir, dan penanda anomali (negara baru, lonjakan 4xx/5xx). Tab **Log penggunaan** di `/dev/api-keys` menampilkan log lintas kunci dengan filter dan export CSV. Retensi baris mentah diatur di Settings → Retensi log.
- **Kunci pribadi** — setiap user yang masuk bisa membuat kunci sendiri di `/profile` (maks. 10 aktif) lewat `/api/me/api-keys`; scope dibatasi role-nya, hanya pemiliknya yang bisa mengelola, dan kunci API tidak bisa dipakai untuk mengelola kunci. Overview `/dev` dan sidebar memperingatkan kunci yang berakhir dalam 7 hari.
- **API** (`/api/api-keys`, super-admin, semua aksi teraudit): `GET` list (`page`, `limit`, `search`, `status`, `ownerId`, `scope`), `GET /stats`, `GET /scopes`, `POST` buat (mengembalikan `key` sekali), `GET /:id`, `GET /:id/usage`, `PUT /:id`, `POST /:id/rotate`, `POST /:id/revoke`, `DELETE /:id`; log lintas kunci `GET /api/api-keys/usage` (`keyId`, `status=2xx|4xx|5xx|errors`, `method`, `search`, `days`, `page`, `limit`) dan `GET /api/api-keys/usage/export` (CSV, maks. 10.000 baris). Kunci pribadi: `/api/me/api-keys` dengan operasi yang sama tanpa `ownerId`.
- **MCP** — `/api/mcp` menerima API key ber-scope `mcp` (`Authorization: Bearer mk_live_…`, hanya pemilik super-admin), sehingga tiap agent punya kunci sendiri yang bisa dicabut dan terlacak pemakaiannya. `MCP_ADMIN_TOKEN` di env tetap diterima sebagai jalur lama (header Bearer atau `?mcpAdminToken=`); tanpa env itu, hanya API key yang diterima. Contoh `.mcp.json` ada di `.mcp.json.example` (kunci dari env `MAKURO_MCP_KEY`).

## Rate limiting

Setiap request `/api/*` dibatasi per IP klien dengan jendela geser. Default 100 request / 60 detik dari env `RATE_LIMIT_MAX` dan `RATE_LIMIT_WINDOW_MS`; super-admin bisa menimpanya (batas, jendela, path yang dikecualikan, atau mematikan sementara) di `/dev/settings` tanpa restart — nilai tersimpan di `app_setting`, `NULL` berarti pakai default env. `/api/auth/*` (Better Auth) dan `/api/mcp` (API key/token) dikecualikan. Setiap response membawa `X-RateLimit-Limit` / `X-RateLimit-Remaining`; request yang ditolak mendapat 429 + `Retry-After`, dan request yang ditolak tidak memperpanjang jendela. IP klien adalah alamat socket yang distempel server (`server/middleware/client-ip.ts`); `X-Forwarded-For` / `X-Real-IP` hanya dipercaya bila socket itu proxy di `TRUSTED_PROXIES`, dan yang dipakai adalah hop paling kanan yang bukan proxy tepercaya — header palsu dari klien tidak membuat bucket baru.

Plugin `rateLimitPlugin()` harus didaftarkan **pertama** di `server/api/index.ts` — hook Elysia hanya berlaku untuk route yang didaftarkan setelahnya. Request yang ditolak dicatat ke `rate_limit_log` (method, IP, geo, perangkat) dan ditampilkan di `/dev/rate-limit-logs` dengan API `/api/analytics/rate-limit-logs` (`search`, `ip`, `path`, `method`, `country`, `device`, `days`, `/stats`, `/export`, `DELETE` massal). State limiter ada di memori proses; untuk multi-instance gunakan Redis.

## Speech API (kompatibel OpenAI)

App ini juga speech server lokal: speech-to-text memakai **Qwen3-ASR 1.7B** (GGUF lewat `libcrispasr`) dan text-to-speech memakai **Supertonic 3** (ONNX lewat `onnxruntime-node`). Endpoint di `/api/v1` meniru API audio OpenAI, jadi SDK `openai` (dan klien lain yang kompatibel) cukup diarahkan ke `baseURL: <host>/api/v1`.

**Auth.** Buat API key di `/profile` (kunci pribadi) atau `/dev/api-keys` dengan scope `stt:transcribe` (transkripsi) dan/atau `tts:speak` (sintesis), lalu kirim sebagai `Authorization: Bearer <key>` — SDK melakukannya dari `apiKey`. Sesi login browser juga diterima. Tanpa kredensial → `401 invalid_api_key`. `GET /models`, `/models/:id`, dan `/audio/voices` publik.

```js
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.S4S_API_KEY, baseURL: 'https://your-host/api/v1' });
```

### Model & voice

`GET /api/v1/models` mendaftar model beserta aliasnya; `GET /api/v1/models/:id` → `404 model_not_found` bila tidak dikenal. `GET /api/v1/audio/voices` (ekstensi s4s) → `{ object: 'list', data: [{ id, object: 'voice', voice }] }`.

| Model asli | Alias OpenAI yang diterima |
|---|---|
| `qwen3-asr-1.7b` (STT) | `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` |
| `supertonic-3` (TTS) | `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` |

Voice asli `F1`–`F5` dan `M1`–`M5`; nama voice OpenAI dipetakan (tidak peka huruf besar): `alloy`→F1, `coral`/`marin`→F2, `fable`→F3, `nova`→F4, `shimmer`/`sage`→F5, `ash`→M1, `ballad`→M2, `echo`→M3, `onyx`/`cedar`→M4, `verse`→M5.

```bash
curl https://your-host/api/v1/models
curl https://your-host/api/v1/audio/voices
```

```js
const models = await client.models.list();
```

### `POST /api/v1/audio/transcriptions`

Multipart dengan `file` dan `model`. Opsi:

- `response_format`: `json` (default), `text`, `srt`, `vtt`, `verbose_json` (+ `timestamp_granularities[]` = `word`/`segment`).
- `stream=true` (hanya untuk `json`/`text`): SSE `transcript.text.delta` lalu `transcript.text.done` dengan `usage: { type: 'duration', seconds }`. Qwen3-ASR tidak punya callback per token, jadi delta datang **per potongan VAD**, bukan per kata — audio pendek bisa hanya satu delta.
- `language`: kode ISO-639-1; kosong → `STT_DEFAULT_LANGUAGE` (default `id`). **Beda dari OpenAI:** OpenAI mendeteksi bahasa otomatis bila `language` kosong, s4s menganggapnya bahasa Indonesia. Untuk audio bahasa lain kirim `language`, atau set `STT_DEFAULT_LANGUAGE=auto` (butuh `STT_LID_MODEL`).
- `prompt` dan ekstensi s4s `keywords` (dipisah koma) dikirim sebagai hotword ke decoder; gabungan maks. 50 istilah dan 1000 karakter, lebih dari itu → `400` dengan `param: 'keywords'`.
- Audio: WAV didecode langsung (PCM 8/16/24/32-bit atau float32); `flac`, `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `ogg`, `webm` lewat ffmpeg.
- Batas: upload > `V1_MAX_UPLOAD_MB` (25) → `413 file_too_large`; durasi > `V1_MAX_AUDIO_SEC` (1800) → `400 audio_too_long`.
- Decode audio dibatasi `V1_DECODE_CONCURRENCY` (2) upload sekaligus; request yang menunggu slot lebih dari `V1_DECODE_WAIT_MS` (5000) → `429 engine_busy`. Bila antrean STT sudah penuh, request ditolak `429` sebelum body upload dibaca.
- Tanpa VAD (`STT_VAD_MODEL` kosong atau gagal), audio dipotong rata per `STT_MAX_CHUNK_SEC`. Klien yang memutus koneksi membatalkan job di batas potongan berikutnya (potongan yang sedang didecode tetap selesai), sehingga antrean langsung bergerak.

```bash
curl https://your-host/api/v1/audio/transcriptions \
  -H "Authorization: Bearer $S4S_API_KEY" \
  -F file=@rapat.m4a -F model=whisper-1 -F language=id -F keywords="Makuro,Supertonic"
```

```js
import fs from 'node:fs';
const stream = await client.audio.transcriptions.create({
  file: fs.createReadStream('rapat.m4a'), model: 'whisper-1', stream: true,
});
for await (const ev of stream) if (ev.type === 'transcript.text.delta') process.stdout.write(ev.delta);
```

`POST /api/v1/audio/translations` tidak didukung → `400` dengan `code: 'unsupported'`.

### `POST /api/v1/audio/speech`

JSON `{ model, input, voice }`; `input` maks. 4096 karakter, `voice` berupa nama atau `{ id }`. Opsi:

- `response_format`: `mp3` (default), `opus`, `aac`, `flac`, `wav`, `pcm`. Selain `wav`/`pcm` butuh ffmpeg; tanpa ffmpeg → `400 unsupported_format`.
- `speed`: 0.25–4.
- `stream_format`: `audio` (default, byte audio di-stream) atau `sse` (event `speech.audio.delta` berisi audio base64, lalu `speech.audio.done` dengan `usage`). `sse` ditolak untuk `tts-1`/`tts-1-hd`, sama seperti OpenAI — pakai `gpt-4o-mini-tts`.
- Ekstensi s4s: `language` (ISO-639-1, default `TTS_DEFAULT_LANGUAGE` = `id`) dan `steps` (langkah denoising, di-clamp 1–20, default `TTS_STEPS` = 8).
- Teks dipecah per unit (`TTS_MAX_UNIT_CHARS`, 400) dan tiap unit dikirim begitu selesai, jadi audio pertama datang sebelum seluruh teks selesai disintesis.

```bash
curl https://your-host/api/v1/audio/speech \
  -H "Authorization: Bearer $S4S_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"tts-1","voice":"alloy","input":"Selamat pagi.","response_format":"wav","language":"id"}' \
  -o pagi.wav
```

```js
const res = await client.audio.speech.create({
  model: 'gpt-4o-mini-tts', voice: 'nova', input: 'Selamat pagi.', language: 'id', // language = ekstensi s4s
});
fs.writeFileSync('pagi.mp3', Buffer.from(await res.arrayBuffer()));
```

### Error, antrean, dan limit

- Error di bawah `/api/v1` berbentuk OpenAI `{ error: { message, type, param, code } }` (termasuk 401, 404, 429 rate limit IP), sehingga SDK melempar exception yang tepat. Route `/api/*` lain tetap memakai `{ error, code, status, requestId }`.
- Tiap engine memproses satu request sekaligus dengan antrean (`STT_MAX_QUEUE` 4, `TTS_MAX_QUEUE` 8). Antrean penuh → `429 engine_busy` + `Retry-After`; engine tidak tersedia, atau di-unload saat job berjalan (idle, `/dev/engines`, shutdown) → `503 engine_unavailable` (+ `Retry-After` untuk unload).
- Rate limit IP global (lihat **Rate limiting**) juga berlaku untuk `/api/v1`.

### Engine & kebutuhan

Engine dimuat malas: child process dan model baru dimuat pada request pertama (atau lewat tombol warmup), lalu dilepas setelah idle (`STT_IDLE_TIMEOUT_SEC`/`TTS_IDLE_TIMEOUT_SEC`, 600 dtk). `bun run dev`/`start`/binary mendaftarkan engine saat boot dan melepasnya dengan rapi saat SIGINT/SIGTERM. Super-admin memantau dan mengendalikannya di `/dev/engines` (status, RSS, latensi, warmup/unload; API `GET /api/engines`, `POST /api/engines/:kind/warmup|unload`, sesi browser saja) dan mencobanya di `/dev/playground`.

Yang harus ada di mesin (path diatur lewat env, lihat komentar di `.env.example`):

- **STT** — shared library `libcrispasr` (`CRISPASR_LIB`), model Qwen3-ASR GGUF (`STT_MODEL`), opsional Silero VAD (`STT_VAD_MODEL`) untuk memotong audio panjang dan model language-ID (`STT_LID_MODEL`). Tuning: `STT_THREADS`, `STT_MAX_CHUNK_SEC`.
- **TTS** — direktori model Supertonic berisi `onnx/` dan `voice_styles/` (`TTS_MODEL_DIR`). Tuning: `TTS_STEPS`, `TTS_THREADS`, `TTS_MAX_UNIT_CHARS`.
- **ffmpeg** — untuk decode upload non-WAV dan encode mp3/opus/aac/flac (`FFMPEG_PATH`); default `ffmpeg` di `PATH`.
- **Cek saat boot** — server memeriksa semua path di atas dan ffmpeg sekali saat start; yang hilang dicatat satu baris log per item (`error` di production, `warn` di dev) dan tampil di field `deps` `GET /api/engines`. Server tetap jalan; engine baru gagal saat dipakai. Encode ffmpeg dihentikan setelah `TTS_FFMPEG_TIMEOUT_MS` tanpa audio baru (idle), bukan total durasi stream.
- **Memori** — child STT memakai sekitar 3 GB RSS dan child TTS sekitar 0,5 GB, jadi mesin 8 GB cukup untuk keduanya. Tiap upload yang sedang didecode juga memegang file + PCM float32 (±230 MB untuk audio 30 menit) dan antrean STT menyimpan PCM tiap job. Untuk host 8 GB disarankan `STT_MAX_QUEUE=2`, `V1_MAX_AUDIO_SEC=600`, dan `V1_DECODE_CONCURRENCY=1`–`2`.

## File health & penyelamat konteks agent

`/dev/file-health` (super-admin) memindai seluruh repo (kecuali `node_modules`, `build`, `.git`, cache) dan menilai setiap file teks:

- **Limit baris per peran** — route/handler 150, service 300, repository/query 250, schema 200, types 300, utility 200, config 100, test 400, page/component 300; hard limit global 500 baris / 20.000 karakter. Migration, generated, seed, fixture, lockfile, dan skill vendor (`.agents/`) dikecualikan. Aturan ada di `server/file-health/file-health.rules.ts`.
- **Risiko konteks agent** — estimasi token (≈ 4 karakter/token). ≥ 5.000 token = hati-hati, ≥ 15.000 = bahaya. Tujuannya mencegah AI agent membaca file seperti `bun.lock` secara utuh dan menghabiskan context window.

Agent bisa mengecek sendiri lewat tool MCP `check_file_health` (server `makuro-debug`): tanpa argumen mengembalikan ringkasan, file lewat/hampir limit, dan daftar file berbahaya; dengan `path` mengembalikan metrik + saran cara membaca file itu. REST: `GET /api/file-health` (filter `status`, `kind`, `hazard`, `search`, `sort`, `page`, `limit`, `refresh=true` untuk melewati cache 30 detik) dan `GET /api/file-health/file?path=`.

## Testing

```bash
# Pastikan DATABASE_URL_TEST di .env
bun run test
```

Semua test ada di root `tests/` (mirror struktur `server/`). Gunakan `bun run test` — script inilah yang men-set `NODE_ENV=test`; menjalankan `bun test tests` langsung tidak akan memakai test database. Test database dipisah dari dev/prod (`DATABASE_URL_TEST`); migrasi baru harus dijalankan ke keduanya.

Pola autentikasi di integration test: stub `auth.api.getSession` dan `resolveUserRole` dengan `spyOn` lalu pakai guard asli (lihat `tests/api/posts.test.ts`, `tests/api/me-api-keys.test.ts`). `mock.module('../../server/guard', …)` hanya aman untuk route yang cuma memakai `requireRole`; mock yang mengganti `resolveActor` bocor ke file test lain dalam satu run. Identitas API key bisa disimulasikan dengan `setApiKeyIdentity(request, …)`. Hook `onAfterResponse` (log pemakaian) berjalan setelah `app.handle()` selesai — tunggu sejenak sebelum `flushUsage()`.

## Catatan teknis

- **SSR di Bun**: import `react-dom/server.node` bukan bare `react-dom/server` (bare specifier resolve ke web-streams build tanpa `renderToPipeableStream`).
- **Bundle SSR berisi salinan kode server**: modul `@server/*` yang diimpor dari `app/` (loader, `entry.server.tsx`) ikut dibundel Vite ke `build/server/index.js`, jadi singleton seperti logger akan punya dua instance. `entry.server.tsx` melapor lewat `@server/ssr-log` (jembatan `globalThis` yang diisi `server/logger.ts`), bukan mengimpor logger langsung.
- **pino-roll v4** menerima satu objek opsi (`{ file, frequency: 'daily', size, limit, mkdir }`); bentuk lama `build(path, opts)` melempar "No file name provided" dan membuat `bun run start` gagal boot.
- **No FOUC**: `ColorSchemeScript` + inline `<style>` blocking di `<head>` di `root.tsx` — background warna yang benar dirender sebelum Mantine CSS dimuat.
- **Multiple Set-Cookie**: `http-bridge.ts` pakai `Headers.getSetCookie()` (WinterCG) untuk kumpulkan semua Set-Cookie header, lalu set sekaligus sebagai array ke Node.js response. Ini kritis untuk multi-session Better Auth.
- **Sidebar collapsed state**: disimpan di cookie `mk-sidebar-collapsed`, dibaca server-side di layout loader — tidak ada flash saat hard reload.
- **Urutan hook Elysia**: `derive` di route berjalan pada fase transform, *sebelum* `onBeforeHandle` global mana pun. Plugin yang menyuntik identitas untuk route ber-`derive` (auth API key) harus memakai `onRequest`; hook lain hanya berlaku untuk route yang didaftarkan setelahnya.
- **Mount Better Auth = catch-all**: `.mount(handler)` menangkap semua path `/api/*` yang tidak cocok, jadi `server/api/index.ts` hanya meneruskan `/api/auth/*` ke Better Auth dan mengembalikan JSON 404 untuk sisanya.
- **Better Auth apiKey**: panggilan server-side (`createApiKey`, `updateApiKey`) tidak boleh membawa `headers` (dianggap request klien → `SERVER_ONLY_PROPERTY`); scope kurang dilaporkan sebagai `KEY_NOT_FOUND`, sehingga scope dicek sendiri di `server/api-keys/plugin.ts`; `requestCount` hanya counter jendela rate limit, total pemakaian ada di `api_key_usage`.
- **Tanggal di fragmen `sql` mentah**: fragmen raw tidak mendapat pemetaan tipe kolom — kirim `${d.toISOString()}::timestamp`, bukan objek `Date`.
- **Dev server `--hot`**: plugin Elysia atau hook baru tidak selalu ikut dimuat ulang; restart `bun run dev` setelah menambah plugin. Untuk smoke test jalankan instance kedua dengan `PORT=<lain> bun run server/dev.ts` agar tidak mengganggu server yang sedang berjalan.

## Lisensi

MIT
