# st4s ⚡

**st4s** — speech-to-text & text-to-speech server kompatibel OpenAI (STT Qwen3-ASR, TTS Supertonic) dengan **satu port, tanpa CORS, siap production**. Frontend dan backend berjalan dalam satu proses Elysia — tidak ada proxy, tidak ada CORS config, cookies langsung bekerja.

```
Browser  →  Bun/Node :3005
              /api/auth/*  →  Better Auth
              /api/*       →  Elysia API (Eden Treaty)
              /assets/*    →  static Vite (immutable, prod)
              /*           →  React Router v8 SSR
```

## Untuk AI agent

README ini adalah sumber dokumentasi umum, sedangkan `/skill.md` (`docs/skill.md`) adalah panduan pemakaian Speech API; keduanya bisa dibaca tanpa JavaScript:

- `GET /README.md` — file ini apa adanya (`text/markdown`), juga `/llms-full.txt` (`text/plain`).
- `GET /llms.txt` — indeks singkat (judul, ringkasan, daftar bagian, endpoint untuk agent), dibangkitkan dari heading README.
- `GET /api/version` — `{ name, version, env, bun }`, publik.
- API dipakai dengan header `X-API-Key: mk_live_…` atau `Authorization: Bearer mk_live_…`; scope per route ada di bagian **API keys**. Semua error API berbentuk JSON `{ error, code, status, requestId }`.
- Server MCP di `/api/mcp` (Streamable HTTP) menerima API key ber-scope `mcp`; katalog tool ada di bagian **Dev console → Tools & MCP**.
- Speech-to-text dan text-to-speech kompatibel OpenAI ada di `/api/v1` (`baseURL: <host>/api/v1` di SDK `openai`); panduan pemakaian untuk agent (auth, contoh, endpoint, kode error) di `GET /skill.md`.

Untuk mesin pencari: `/robots.txt` (area login, konsol, dan API ditutup) dan `/sitemap.xml` dibangun dari `APP_URL`, sedangkan landing punya meta Open Graph/Twitter, `og:image` (`/og.png`, 1200×630), dan `canonical` — jadi set `APP_URL` ke origin publik di produksi.

URL dokumentasi (`/README.md`, `/llms.txt`, `/llms-full.txt`, `/skill.md`) dilayani sebelum SSR, ber-ETag (`304` bila tidak berubah), tidak dihitung sebagai kunjungan, dan tetap tersedia saat mode maintenance.

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
# Wajib: BETTER_AUTH_SECRET (openssl rand -base64 32)
# Opsional untuk test: DATABASE_URL_TEST (nama berakhiran _test); kosong = PostgreSQL test bawaan (./data/pg-test)
# DATABASE_URL: URL PostgreSQL ≥ 17, atau kosong = PostgreSQL 17 bawaan (./data/pg, hanya unix socket)
# Opsional: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
# Key lain sengaja dikomentari (= default di code); buka komentar hanya untuk mengubahnya

# 3. Buat database dan jalankan migrasi
# DATABASE_URL kosong: db:migrate menyiapkan PostgreSQL bawaan (./data/pg) sendiri — lewati opsi A/B
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
| `bun run dev` | Dev server satu port (Elysia + Vite HMR + RR SSR); `DATABASE_URL` kosong → PostgreSQL bawaan dinyalakan dulu (`server/local-pg/entry.ts`) |
| `bun run build` | Build client + server bundle |
| `bun run start` | Production server (`server/prod.ts` lewat `server/local-pg/entry.ts`, NODE_ENV=production) |
| `bun run smoke:prod` | Build lalu boot `server/prod.ts` di port bebas dan jalankan 22 pemeriksaan black-box (`scripts/smoke-server.ts`) |
| `bun run smoke:binary` | Sama, tetapi terhadap binary hasil `build:binary` |
| `bun run smoke:coldboot` | Binary di `ST4S_HOME` kosong tanpa `DATABASE_URL`: `init` → `migrate` → `doctor` → server → pemeriksaan → SIGTERM, tanpa proses tersisa (`scripts/smoke-coldboot.ts`; `ST4S_PG_ARCHIVE` untuk offline) |
| `bun run build:binary` | Build binary native (platform saat ini) |
| `bun run build:binary:linux` | Cross-compile ke Linux x64 glibc |
| `bun run build:binary:linux-musl` | Cross-compile ke Linux x64 musl (Alpine/Docker) |
| `bun run typecheck` | `react-router typegen` + `tsc --noEmit` |
| `bun run lint` | Biome check |
| `bun run format` | Biome format --write |
| `bun run db:generate` | Generate SQL migration dari Drizzle schema (tanpa koneksi database) |
| `bun run db:migrate` | Apply migration — sama dengan `st4s migrate` (`DATABASE_URL` kosong → PostgreSQL bawaan dinyalakan lalu dimatikan, atau memakai milik `bun run dev` yang sedang jalan) |
| `bun run db:push` | Push schema langsung (interaktif); database sama seperti `db:migrate` |
| `bun run db:studio` | Drizzle Studio; database sama seperti `db:migrate` (Ctrl+C mematikan PostgreSQL bawaan yang dinyalakannya) |
| `bun run st4s <perintah>` | CLI `st4s` dari source: `doctor`, `migrate`, `db backup` (→ `./data/backups`), `db restore <file> [--yes]`, `--version`. `init` dan mode server ditolak — pakai `bun run dev`/`start` |
| `bun run admin:verify <email>` | Tandai email user di `SUPER_ADMIN_EMAILS` sebagai terverifikasi (bootstrap super-admin tanpa Google) |
| `bun run test` | Test suite (bun:test, `tests/`; selalu di database `*_test`, lihat [Testing](#testing)) |

## Binary distribution (tanpa Bun di server)

```bash
# Build binary untuk platform saat ini
bun run build:binary          # → ./st4s

# Cross-compile ke Linux (dari Mac atau mana saja)
bun run build:binary:linux      # → ./st4s-linux-x64     (Ubuntu/Debian)
bun run build:binary:linux-musl # → ./st4s-linux-musl    (Alpine, Docker)

# Jalankan di server — satu file, tanpa perlu install Bun atau build/ folder
./st4s-linux-x64
```

**Satu file, tidak ada dependensi eksternal:**

```
st4s-linux-x64   ← binary ~130 MB — semua embedded:
                     • Bun runtime (JavaScriptCore)
                     • Server code (Elysia, Better Auth, Drizzle)
                     • React Router SSR bundle
                     • Seluruh static assets (CSS, JS, favicon, dll)
```

Seperti Go binary: copy satu file ke server, langsung jalan. Tidak perlu `build/`, tidak perlu Node/Bun, tidak perlu `npm install`.

**Verifikasi sebelum deploy:** `bun run smoke:binary` membangun binary, menjalankannya di port acak dengan `NODE_ENV=production`, lalu memeriksa versi, SSR landing/login, redirect guard, favicon, probe, halaman 404, JSON 404 API, Better Auth, penolakan API key palsu dan MCP anonim, `/README.md`, `/llms.txt`, meta OG landing, `/robots.txt`, `/sitemap.xml`, gambar OG, apple-touch-icon, header rate limit, dan aset client ber-cache immutable. `bun run smoke:prod` melakukan hal yang sama untuk mode skrip (`bun run start`). Keduanya keluar dengan kode ≠ 0 bila ada yang gagal.

**`.env` & NODE_ENV:** binary hanya membaca `$ST4S_HOME/.env` (default: folder tempat binary berada, mis. `~/.st4s/.env`); `.env` di direktori kerja **diabaikan** dan variabel environment asli selalu menang. `NODE_ENV` default `production`; nilai lain tetap dihormati tetapi dicetak peringatan saat start (detail error API terbuka, tanpa log file).

> **Teknik:** SSR bundle di-embed via static `import * as ssrBuild from '../build/server/index.js'` — Bun bundler mengikuti static import dan mem-bundle seluruh dependensi (`@react-router/node`, `react-dom`, dll) ke dalam binary. `--asset ./build/client` embed seluruh direktori client ke VFS (tersedia di runtime sebagai `client/` — satu level parent directory di-strip). `inlineDynamicImports: true` di Vite memastikan SSR bundle adalah satu file tunggal tanpa dynamic chunk splits.

**Engine suara di binary:** model, library native, dan ffmpeg **tidak** di-embed — binary membacanya dari `$ST4S_HOME/lib/` dan `$ST4S_HOME/models/` (path di env tetap diutamakan, lihat bagian **Speech API**). Binary menjalankan engine dengan me-re-exec dirinya sendiri sebagai `--st4s-engine-child stt|tts`, jadi tidak butuh Bun di server. TTS memuat `lib/libonnxruntime.1.dylib` sendiri sebelum onnxruntime dipakai, tanpa `DYLD_LIBRARY_PATH` (Linux: `libonnxruntime.so.1`, belum dites).

> **Catatan:** Binary lebih besar (~130 MB) karena embed Bun runtime (JavaScriptCore). Trade-off yang sama dengan semua single-binary JS runtimes (Deno, Node SEA).

### Install (bundle `~/.st4s`)

Rilis = satu tarball berisi binary + `lib/` (libcrispasr, libggml*, libonnxruntime) + `LICENSES/`; model, `.env`, dan log tidak ikut.

```bash
# Maintainer (macOS arm64). Sekali (dan setelah pin/patch CrispASR berubah): build rilis libcrispasr,
# terpisah dari lib dev di .crispasr/build agar tidak membangun ulang lib yang sedang dimuat dev server
CRISPASR_BUILD_DIR="$PWD/.crispasr/build-reloc" bash scripts/crispasr/build.sh
bash scripts/release/package.sh   # → dist/st4s-<versi>-darwin-arm64.tar.gz + .sha256 + dist/install.sh

# Tim: install atau upgrade ke $ST4S_HOME (default ~/.st4s), tanpa sudo
sh install.sh dist/st4s-<versi>-darwin-arm64.tar.gz   # .sha256 di sampingnya ikut diverifikasi
sh install.sh                                        # tanpa argumen: unduh rilis terbaru GitHub ($ST4S_REPO) + verifikasi .sha256
~/.st4s/st4s init && ~/.st4s/st4s models pull && ~/.st4s/st4s doctor && ~/.st4s/st4s
```

`install.sh` (sumber: `scripts/install.sh`, disalin ke `dist/` untuk diunggah ke halaman rilis) memeriksa OS/arsitektur tarball (`BUILD_INFO`), mengganti `st4s`, `lib/`, `LICENSES/` lewat direktori staging lalu rename (rollback bila gagal), **tidak pernah** menyentuh `.env`, `models/`, `logs/`, `pg/` (runtime `lib/pg/` dibawa ke `lib/` baru), menghapus `com.apple.quarantine` di macOS (binary tidak dinotarisasi), dan hanya memperingatkan bila ffmpeg tidak ada di PATH. Test: `tests/release/install.test.ts`.

### Menjalankan (`st4s init` / `doctor` / `migrate` / `db`)

```bash
~/.st4s/st4s init        # buat lib/ models/ logs/ + .env (mode 0600, BETTER_AUTH_SECRET acak); tidak pernah menimpa .env
$EDITOR ~/.st4s/.env     # isi SUPER_ADMIN_EMAILS; DATABASE_URL opsional (kosong = PostgreSQL bawaan)
~/.st4s/st4s migrate     # terapkan migrasi database (ter-embed di binary)
~/.st4s/st4s models pull # atau `models import <folder>` — lihat "Models" di bawah
~/.st4s/st4s doctor      # checklist ✅/❌ + saran perbaikan; exit 1 bila ada yang wajib gagal
~/.st4s/st4s             # jalankan server (PORT dari .env)
~/.st4s/st4s --version   # versi dari package.json
```

- `init` langsung menjalankan `migrate`. Dengan `DATABASE_URL` kosong ia lebih dulu memasang runtime PostgreSQL 17.11 bawaan ke `lib/pg/` (unduh ±60 MB dari Maven Central, sha256 dipin; offline: `ST4S_PG_ARCHIVE=<path jar>`) dan membuat `pg/data/`.
- **PostgreSQL bawaan** (`DATABASE_URL` kosong): server menyalakannya sebagai child process (hanya unix socket, tanpa port TCP, zona waktu UTC) dan mematikannya saat SIGINT/SIGTERM; setelah crash/`kill -9` start berikutnya memulihkan sendiri. Satu data dir hanya untuk satu st4s. `migrate` memakai Postgres server yang sedang jalan, atau menyalakan dan mematikannya sendiri. Migrasi tetap eksplisit. Override: `ST4S_PG_RUNTIME` (runtime sendiri), `ST4S_PG_DATA` (data dir). Tidak tersedia di Linux musl/Alpine — pakai `DATABASE_URL`. Data dir dari major Postgres lain ditolak. **Platform:** terverifikasi di macOS Apple Silicon (darwin-arm64) dan Linux x64/arm64 (glibc). Di Linux, jalankan sebagai user non-root (initdb menolak root) dan pasang `xz-utils` (tar harus bisa membuka `.xz`); `procps` tidak diperlukan. Belum ada tarball rilis Linux, jadi jalankan dari source (`bun run start`) atau binary yang Anda build sendiri (mis. `bun run build:binary:linux` untuk x64). Di macOS Intel mode bawaan ditolak (`init`, `migrate`, `doctor`, start server) kecuali `ST4S_PG_ALLOW_UNVERIFIED=1` — untuk staging, dengan peringatan satu baris; `doctor` menampilkan status verifikasi dan override. `DATABASE_URL` yang terisi tidak terpengaruh.
- `doctor` memeriksa folder, `.env`, `DATABASE_URL`/`BETTER_AUTH_SECRET` (hanya terisi/kosong, nilai tidak pernah dicetak), koneksi + migrasi database (atau runtime + data dir PostgreSQL bawaan), karantina macOS, `libcrispasr` (dlopen), `libonnxruntime`, file model, ffmpeg, dan RAM bebas. Jalan tanpa `.env`.
- Server binary **menolak start** bila database belum dimigrasi atau tidak bisa dihubungi: `Database belum dimigrasi — jalankan st4s migrate`, exit 1.
- **Backup PostgreSQL bawaan** (`DATABASE_URL` kosong): hentikan st4s dulu (Ctrl+C / SIGTERM), lalu
  ```bash
  ~/.st4s/st4s db backup                    # → ~/.st4s/backups/st4s-db-<YYYYMMDD-HHMMSS>Z.tar.gz (mode 0600)
  ~/.st4s/st4s db backup --out /mnt/usb/st4s.tar.gz   # tidak pernah menimpa file yang sudah ada
  ~/.st4s/st4s db restore <file> [--yes]    # tanpa --yes: konfirmasi y/N (di luar terminal wajib --yes)
  ```
  Arsipnya **snapshot fisik dingin** dari `pg/data` (tar.gz + `st4s-backup.json`), jadi hanya bisa dibuat saat st4s/Postgres berhenti; keduanya menolak dengan PID-nya bila data dir sedang dipakai (Postgres yatim setelah `kill -9`: jalankan `st4s migrate` sekali). Restore hanya ke major yang sama (PostgreSQL 17) dan sebaiknya ke OS/arsitektur yang sama. Arsip divalidasi dulu (manifest, semua entri di `data/`, tanpa link). Data saat ini **dipindah** ke `pg/data.before-restore-<waktu>` (tidak dihapus — hapus manual bila sudah yakin), lalu jalankan `st4s migrate` bila backup berasal dari versi st4s lebih lama. `doctor` menampilkan backup terbaru. Backup panas tanpa menghentikan server, atau lintas major: pakai `pg_dump` (mis. Homebrew `postgresql@17`) ke socket Postgres bawaan. Dengan `DATABASE_URL` terisi `st4s db` menolak — backup database itu dengan `pg_dump`/`pg_restore`.
- **Upgrade:** jalankan ulang `sh install.sh`, lalu `st4s migrate`. `.env`, `models/`, `logs/`, `pg/` dan `lib/pg/` tetap.
- **`ST4S_HOME`:** override folder (default folder binary). Semua perintah di atas memakainya, mis. `ST4S_HOME=/srv/st4s /srv/st4s/st4s doctor`.

### Models (`st4s models`)

19 file (~1,97 GB) di `$ST4S_HOME/models/`, dipin ke commit HuggingFace + sha256 di `server/models/manifest.ts`: `stt/` (Qwen3-ASR 1.7B Q4_K, Silero VAD, Whisper tiny untuk `language=auto`) dan `tts/` (Supertonic 3: `onnx/`, `voice_styles/`, `LICENSE`).

```bash
~/.st4s/st4s models list               # ada/hilang/ukuran salah, total ukuran, lisensi
~/.st4s/st4s models pull [stt|tts|all] # unduh yang belum valid; bisa dilanjutkan (.part + Range)
~/.st4s/st4s models import ~/pack      # offline: cari file sesuai nama (rekursif), verifikasi, salin
~/.st4s/st4s models import             # tanpa path: ~/.cache/crispasr + ~/.wibu/tts/model (layout dev lama)
```

`pull` memeriksa ruang disk dulu, memverifikasi sha256 tiap file sebelum rename atomik, melewati file yang sudah valid, dan keluar ≠ 0 bila ada yang gagal (jalankan ulang untuk melanjutkan). `import` tidak pernah mengubah sumber kecuali dengan `--move`. Mirror: `ST4S_MODELS_BASE_URL` (default `https://huggingface.co`, path `<repo>/resolve/<commit>/<file>` sama).

Lisensi: Qwen3-ASR Apache-2.0, Silero VAD & Whisper MIT, **Supertonic 3 BigScience OpenRAIL-M** — ada batasan penggunaan (Attachment A) yang mengikat setiap pengguna; teksnya ditulis ke `models/tts/LICENSE` dan wajib ikut bila paket model dibagikan ke tim.

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
tests/                  bun:test, mirror struktur server/ (setup/test-db.ts = preload database test)
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

**Login Google (OAuth).** Tombol "Lanjutkan dengan Google" muncul di `/login` (sebagai tombol utama) begitu kedua env di bawah di-set; tanpa keduanya Google mati dan email+password jadi satu-satunya jalan masuk.

1. Google Cloud Console → *APIs & Services* → *Credentials* → *Create OAuth client ID* → tipe **Web application**.
2. **Authorized redirect URI**: `${BETTER_AUTH_URL}/api/auth/callback/google` — harus sama persis dengan origin tempat app diakses (skema, host, port). Contoh dev: `http://localhost:<PORT>/api/auth/callback/google`; produksi: `https://<domain-anda>/api/auth/callback/google`. Daftarkan keduanya bila satu client dipakai untuk dev dan produksi.
3. Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_URL` (origin publik app; juga satu-satunya trusted origin default Better Auth), dan `SUPER_ADMIN_EMAILS`.
4. Restart server.

Perilaku saat masuk lewat Google:

- **Pendaftaran tertutup juga berlaku untuk Google.** Bila sign-up ditutup (`AUTH_DISABLE_SIGNUP` atau toggle "Pendaftaran" di `/dev/settings`), login Google yang akan **membuat user baru** ditolak dan kembali ke `/login?error=signup_disabled` dengan pesan "Pendaftaran akun baru sedang ditutup…". Pengecualian: email di `SUPER_ADMIN_EMAILS` (tanpa membedakan huruf besar/kecil) tetap boleh membuat akun, agar pemilik tidak pernah terkunci. Ditegakkan lewat hook `user.validateUserInfo` Better Auth sebelum user disimpan.
- **User yang sudah ada tetap bisa masuk.** Bila email Google sudah terdaftar dan terverifikasi, akun Google ditautkan otomatis (default `accountLinking` Better Auth). Email yang terdaftar lewat kata sandi tapi **belum terverifikasi** tidak ditautkan (mencegah pengambilalihan akun) dan kembali ke `/login?error=account_not_linked`; user itu masuk dengan email + kata sandi.

**Super-admin & sign-up di produksi.** Role `super-admin` dari `SUPER_ADMIN_EMAILS` hanya diberikan ke email yang **terverifikasi**. Template ini tidak mengirim email verifikasi, jadi di produksi super-admin masuk lewat Google, atau operator menjalankan `bun run admin:verify <email>` (lihat checklist di bawah). Sign-up tertutup saat `NODE_ENV=production` (termasuk binary) kecuali `AUTH_DISABLE_SIGNUP=false` (kosong = belum di-set); login user lama (email maupun Google) tetap jalan, dan akun baru lewat Google hanya untuk email di `SUPER_ADMIN_EMAILS`.

**Toggle "Login email" & "Pendaftaran" di `/dev/settings` ditegakkan server.** `POST /api/auth/sign-in/email` dan `/sign-up/email` yang dinonaktifkan dijawab `403` (`EMAIL_AUTH_DISABLED` / `SIGNUP_DISABLED`) dengan pesan bahasa Indonesia; login Google user lama tidak terpengaruh, tetapi toggle "Pendaftaran" juga menutup akun baru lewat Google (lihat di atas). Aturan efektifnya (satu helper `server/settings-auth.ts`, dipakai hook auth dan halaman login):

- Login email aktif bila toggle "Login email" menyala **atau Google tidak dikonfigurasi** — tanpa Google, email adalah satu-satunya jalan masuk sehingga tidak bisa dimatikan.
- Sign-up aktif bila login email aktif **dan** toggle "Pendaftaran" menyala **dan** sign-up tidak ditutup env (`AUTH_DISABLE_SIGNUP`).

**Checklist deploy (production)**

1. `bun run db:migrate` terhadap database produksi.
2. Set `SUPER_ADMIN_EMAILS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.
3. Bootstrap super-admin — pilih satu:
   - Google: set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, lalu login Google dengan email di `SUPER_ADMIN_EMAILS`.
   - Tanpa Google: jalankan sementara dengan `AUTH_DISABLE_SIGNUP=false`, daftar dengan email itu, jalankan `bun run admin:verify <email>` (menolak email di luar allowlist / user yang belum ada; output hanya email ter-mask), lalu kosongkan lagi `AUTH_DISABLE_SIGNUP` dan restart.
4. Speech: `FFMPEG_PATH`, `CRISPASR_LIB`, `STT_MODEL`, `TTS_MODEL_DIR` (lihat **Speech API**).
5. Binary: pasang lewat `sh install.sh` (library ikut di `lib/`), lalu `st4s migrate` dan `st4s doctor` — lihat **Binary distribution**. Tidak perlu `DYLD_LIBRARY_PATH`.
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

- **Halaman** — `ErrorBoundary` root (`app/components/errors/ErrorPage.tsx`) merender 404/401/403/5xx dengan judul, penjelasan, langkah berikutnya, path, kode referensi, dan aksi yang relevan (kembali, muat ulang, beranda, masuk). Di dalam area ber-sidebar (`/dev`, `/dashboard`, `/profile`) halaman yang gagal tetap menampilkan sidebar (boundary di tiap layout). Detail teknis hanya tampil di development. Judul tab ikut kode status (`404 Halaman tidak ditemukan — st4s`) dan `noindex`.
- **API** — `server/api-error.ts` menyeragamkan semua error `/api/*` menjadi `{ error, code, status, requestId, method, path }`: 404 JSON untuk route/method tak dikenal (termasuk yang tadinya ditelan mount Better Auth), 422 dengan `issues[{ path, message }]` untuk validasi (tanpa dump skema), 400 body tak terbaca, 500 dengan pesan generik di produksi. Setiap 5xx dicatat sekali ke log dengan `requestId` yang sama seperti header `X-Request-Id`, jadi laporan user bisa langsung dicocokkan.
- **Fallback tanpa React** — bila SSR sendiri gagal, `server/error-page.ts` mengirim HTML statis (500/503, dark-mode aware, dengan kode referensi) baik di dev maupun prod; halaman pemeliharaan (503) memakai pola yang sama.

## Versi

Versi aplikasi punya satu sumber: `version` di `package.json` (dibaca `server/app-info.ts`). Nilai yang sama tampil di header sidebar konsol, halaman Tools, statistik landing, dan `GET /api/version` (publik, tanpa auth) yang mengembalikan `{ name, version, env, bun }` — cocok untuk probe deploy/uptime. Naikkan versi lewat `package.json` saja.

## API keys

Akses terprogram ke `/api/*` tanpa cookie sesi. Dikelola super-admin di `/dev/api-keys`; dibangun di atas plugin `@better-auth/api-key` (kunci di-hash, hanya prefix yang disimpan terbaca).

- **Format & header** — kunci `mk_live_…`, dikirim lewat `X-API-Key: <key>` atau `Authorization: Bearer <key>`. Nilai asli hanya ditampilkan **sekali** saat dibuat/dirotasi.
- **Scope** — tiap route memetakan ke satu scope (`server/api-keys/scopes.ts`, mis. `users:read`, `analytics:write`, `me:read`). Kunci tidak pernah melebihi role pemiliknya: scope di atas role ditolak saat dibuat, dan jika role pemilik turun belakangan request mendapat `403 ROLE_TOO_LOW`. Route auth dan manajemen kunci tidak bisa diakses dengan kunci; MCP butuh scope `mcp`.
- **Kedaluwarsa & rotasi** — default 90 hari, maksimum 1 tahun; tanpa kedaluwarsa hanya untuk pemilik super-admin. Rotasi membuat kunci baru dengan pengaturan sama dan memberi kunci lama masa tenggang 24 jam. Cabut = permanen tapi riwayat tetap; hapus = baris dan riwayatnya hilang.
- **Pembatasan** — rate limit per kunci (opsional, `429 RATE_LIMIT_EXCEEDED`; kuota habis `429 INSUFFICIENT_QUOTA`), daftar IP/prefix yang diizinkan (`403 IP_NOT_ALLOWED`), nonaktifkan sementara (`401 INVALID_API_KEY` — semua key tak valid/kedaluwarsa/nonaktif/dicabut memakai kode ini; di `/api/v1` huruf kecil).
- **Jejak pemakaian** — tiap request dicatat ke `api_key_usage` (method, path, status, IP, negara, UA, durasi) secara batch, lalu digulung per hari ke `api_key_usage_daily` (job tiap jam, upsert monoton) sehingga grafik 90 hari dan total seumur kunci tetap murah dan tidak hilang saat retensi menghapus baris mentah. Halaman detail menampilkan total, harian 90 hari, endpoint/IP/negara tersering, request terakhir, dan penanda anomali (negara baru, lonjakan 4xx/5xx). Tab **Log penggunaan** di `/dev/api-keys` menampilkan log lintas kunci dengan filter dan export CSV. Retensi baris mentah diatur di Settings → Retensi log.
- **Kunci pribadi** — setiap user yang masuk bisa membuat kunci sendiri di `/profile` (maks. 10 aktif) lewat `/api/me/api-keys`; scope dibatasi role-nya, hanya pemiliknya yang bisa mengelola, dan kunci API tidak bisa dipakai untuk mengelola kunci. Overview `/dev` dan sidebar memperingatkan kunci yang berakhir dalam 7 hari.
- **API** (`/api/api-keys`, super-admin, semua aksi teraudit): `GET` list (`page`, `limit`, `search`, `status`, `ownerId`, `scope`), `GET /stats`, `GET /scopes`, `POST` buat (mengembalikan `key` sekali), `GET /:id`, `GET /:id/usage`, `PUT /:id`, `POST /:id/rotate`, `POST /:id/revoke`, `DELETE /:id`; log lintas kunci `GET /api/api-keys/usage` (`keyId`, `status=2xx|4xx|5xx|errors`, `method`, `search`, `days`, `page`, `limit`) dan `GET /api/api-keys/usage/export` (CSV, maks. 10.000 baris). Kunci pribadi: `/api/me/api-keys` dengan operasi yang sama tanpa `ownerId`.
- **MCP** — `/api/mcp` menerima API key ber-scope `mcp` (`Authorization: Bearer mk_live_…`, hanya pemilik super-admin), sehingga tiap agent punya kunci sendiri yang bisa dicabut dan terlacak pemakaiannya. `MCP_ADMIN_TOKEN` di env tetap diterima sebagai jalur lama (header Bearer atau `?mcpAdminToken=`); tanpa env itu, hanya API key yang diterima. Contoh `.mcp.json` ada di `.mcp.json.example` (kunci dari env `ST4S_MCP_KEY`).

## Rate limiting

Setiap request `/api/*` dibatasi per IP klien dengan jendela geser. Default 100 request / 60 detik dari env `RATE_LIMIT_MAX` dan `RATE_LIMIT_WINDOW_MS`; super-admin bisa menimpanya (batas, jendela, path yang dikecualikan, atau mematikan sementara) di `/dev/settings` tanpa restart — nilai tersimpan di `app_setting`, `NULL` berarti pakai default env. `/api/auth/*` (Better Auth) dan `/api/mcp` (API key/token) dikecualikan. Setiap response membawa `X-RateLimit-Limit` / `X-RateLimit-Remaining`; request yang ditolak mendapat 429 + `Retry-After`, dan request yang ditolak tidak memperpanjang jendela. IP klien adalah alamat socket yang distempel server (`server/middleware/client-ip.ts`); `X-Forwarded-For` / `X-Real-IP` hanya dipercaya bila socket itu proxy di `TRUSTED_PROXIES`, dan yang dipakai adalah hop paling kanan yang bukan proxy tepercaya — header palsu dari klien tidak membuat bucket baru.

Plugin `rateLimitPlugin()` harus didaftarkan **pertama** di `server/api/index.ts` — hook Elysia hanya berlaku untuk route yang didaftarkan setelahnya. Request yang ditolak dicatat ke `rate_limit_log` (method, IP, geo, perangkat) dan ditampilkan di `/dev/rate-limit-logs` dengan API `/api/analytics/rate-limit-logs` (`search`, `ip`, `path`, `method`, `country`, `device`, `days`, `/stats`, `/export`, `DELETE` massal). State limiter ada di memori proses; untuk multi-instance gunakan Redis.

## Speech API (kompatibel OpenAI)

App ini juga speech server lokal: speech-to-text memakai **Qwen3-ASR 1.7B** (GGUF lewat `libcrispasr`) dan text-to-speech memakai **Supertonic 3** (ONNX lewat `onnxruntime-node`). Endpoint di `/api/v1` meniru API audio OpenAI, jadi SDK `openai` cukup diarahkan ke `baseURL: <host>/api/v1`.

**Panduan pemakaian lengkap** (auth, quickstart curl/Python/JS, parameter tiap endpoint, event SSE dan WebSocket, tabel kode error) ada di [`docs/skill.md`](docs/skill.md), dilayani publik di `GET /skill.md` dengan URL dasar diisi dari `APP_URL`. Test `tests/skill-doc.test.ts` memastikan setiap route `/api/v1` dan setiap kode error v1 di kode tercantum di sana.

- **Endpoint:** `GET /api/v1/models`, `/models/:id`, `/audio/voices` (publik); `POST /api/v1/audio/transcriptions` (scope `stt:transcribe`, opsional SSE); `POST /api/v1/audio/speech` (scope `tts:speak`, stream audio atau SSE); WebSocket `/api/v1/realtime` (OpenAI Realtime, hanya sesi transkripsi, scope `stt:transcribe`); `POST /api/v1/audio/translations` → `400 unsupported`.
- **Auth:** API key dari `/profile` atau `/dev/api-keys` sebagai `Authorization: Bearer` / `X-API-Key`, atau sesi login browser. Error di bawah `/api/v1` berbentuk OpenAI `{ error: { message, type, param, code } }`; route `/api/*` lain tetap `{ error, code, status, requestId }`.
- **Spec OpenAPI:** `GET /api/v1/openapi.json` — JSON OpenAPI 3.1 untuk endpoint `/api/v1` saja (tanpa UI dokumentasi). Butuh API key valid apa pun scope-nya, atau sesi login; tanpa autentikasi → `401 invalid_api_key`.
- **Beda utama dari OpenAI:** `language` kosong = `STT_DEFAULT_LANGUAGE` (default `id`), bukan deteksi otomatis (set `auto` + `STT_LID_MODEL` bila perlu); delta streaming per potongan VAD, bukan per token.
- **Batas (env, default):** upload `V1_MAX_UPLOAD_MB` 25, durasi `V1_MAX_AUDIO_SEC` 1800, decode `V1_DECODE_CONCURRENCY` 2 / `V1_DECODE_WAIT_MS` 5000, antrean `STT_MAX_QUEUE` 4 / `TTS_MAX_QUEUE` 8, potongan teks TTS `TTS_MAX_UNIT_CHARS` 400, realtime `RT_MAX_SESSIONS` 2 / `RT_MAX_SESSION_SEC` 1800 / `RT_IDLE_TIMEOUT_SEC` 120 / `RT_MAX_TURN_SEC` 60. Rate limit IP global (lihat **Rate limiting**) juga berlaku.
- **Realtime di belakang proxy:** teruskan header `Upgrade`/`Connection` dan set `proxy_read_timeout` ≥ `RT_IDLE_TIMEOUT_SEC`. SDK `openai` (`OpenAIRealtimeWS`) selalu memakai `wss://`, jadi butuh TLS. Tiap giliran yang di-commit tercatat sebagai pemakaian API key (`WS /api/v1/realtime`).

### Engine & kebutuhan

Engine dimuat malas: child process dan model baru dimuat pada request pertama (atau lewat tombol warmup), lalu dilepas setelah idle (`STT_IDLE_TIMEOUT_SEC`/`TTS_IDLE_TIMEOUT_SEC`, 600 dtk). `bun run dev`/`start`/binary mendaftarkan engine saat boot dan melepasnya dengan rapi saat SIGINT/SIGTERM. Super-admin memantau dan mengendalikannya di `/dev/engines` (status, RSS, latensi, warmup/unload; API `GET /api/engines`, `POST /api/engines/:kind/warmup|unload`, sesi browser saja) dan mencobanya di `/dev/playground`.

Yang harus ada di mesin (path diatur lewat env, lihat komentar di `.env.example`):

- **STT** — shared library `libcrispasr` (`CRISPASR_LIB`), model Qwen3-ASR GGUF (`STT_MODEL`), opsional Silero VAD (`STT_VAD_MODEL`) untuk memotong audio panjang dan model language-ID (`STT_LID_MODEL`). Tuning: `STT_THREADS`, `STT_MAX_CHUNK_SEC`, `STT_GPU` (default mati = decode CPU; `1` = Metal dengan fallback ke CPU).
  - **libcrispasr ber-patch (default)** — default `.crispasr/build/src/libcrispasr.dylib` di direktori kerja (root project; `.crispasr/` di-gitignore), hasil `bash scripts/crispasr/build.sh` — `CRISPASR_LIB` tidak perlu di-set. `CRISPASR_LIB` opsional untuk memakai lib lain; lib yang tidak ada atau gagal dimuat membuat engine STT gagal dengan pesan berisi path-nya dan perintah build; rilis sebelum v0.8.41 memuat GGUF dua kali sehingga puncak RAM STT ~3,5 GB (bukan ~2,1 GB). `scripts/crispasr/build.sh` meng-clone CrispASR (`CRISPASR_SRC`, default GitHub upstream; checkout lokal seperti `~/tmp/stt` menghemat unduhan) ke `CRISPASR_DIR` (default `<root project>/.crispasr`, ditentukan dari lokasi skrip, bukan cwd), checkout rilis `v0.8.41` (`CRISPASR_TAG`, harus sama dengan `CRISPASR_REF` `340d7085eaa53c40a46dcb73a6d3d0448a480006`; tag diambil dari upstream bila source lokal belum punya), menerapkan satu patch, lalu build `-j2` (`JOBS`). Salinan yang sudah ada di commit lain ditolak — pakai `CRISPASR_DIR` baru. v0.8.41 sudah memuat encoder audio yang hanya membaca tensor `audio.*` dan `-3` untuk model VAD yang tidak bisa dimuat. `crisp-vad-inference-error.patch` (belum ada di upstream) menambahkan `-3` bila inferensi Silero gagal, bukan `0` ("tidak ada suara") — tanpa patch ini VAD yang gagal jalan diam-diam menghasilkan transkrip kosong. v0.8.41 juga membawa *VAD failover*: klip ≥120 dtk yang (hampir) tanpa ucapan didecode utuh dan Qwen3-ASR mengarang teks; st4s selalu menjalankan child STT dengan `CRISPASR_VAD_FAILOVER=0` (tidak bisa ditimpa env) agar audio tanpa ucapan tetap menghasilkan transkrip kosong. Dengan patch, bila `STT_VAD_MODEL` di-set tetapi VAD gagal, transkripsi gagal dengan 500 `vad_failed` (nama file model + durasi audio di log), bukan beralih ke potongan tetap — tanpa VAD, Qwen3-ASR mengarang teks untuk audio hening; realtime `server_vad` mengirim event error `vad_failed`. Potongan tetap `STT_MAX_CHUNK_SEC` hanya dipakai bila `STT_VAD_MODEL` sengaja dikosongkan. Patch yang sudah ada di source dilewati (skrip mendeteksinya). Bila `CRISPASR_DIR` diubah, arahkan `CRISPASR_LIB` ke `<CRISPASR_DIR>/build/src/libcrispasr.dylib`. Patch itu juga yang akan dikirim ke upstream; hapus dari `build.sh` setelah upstream merilisnya.
  - **Dekoder AMR/Opus dimatikan & lib relocatable** — `build.sh` membangun dengan `-DCRISPASR_AMR=OFF -DCRISPASR_OPUS=OFF`: st4s selalu mengirim PCM hasil decode ffmpeg dan tidak memakai `crispasr_audio_load*`, sedangkan bila hidup lib menautkan opencore-amr/opusfile Homebrew lewat path absolut sehingga tidak bisa dipindah ke mesin lain. `CRISPASR_BUILD_DIR` (default `<CRISPASR_DIR>/build`, lib dev) memilih direktori build lain; build rilis yang dibundel `package.sh` dan `bundle-lib.sh` (default keduanya) adalah `<CRISPASR_DIR>/build-reloc`. `package.sh` memeriksa `CMakeCache.txt` direktori itu sebelum build binary dan berhenti dengan perintah build-nya bila belum ada atau AMR/Opus belum OFF; `CRISPASR_BUILD_DIR` tetap bisa menimpanya. Lib di direktori build memakai rpath absolut ke build tree; untuk distribusi, `bash scripts/crispasr/bundle-lib.sh <out_lib_dir> [build_dir]` menyalin `libcrispasr.dylib` + `libggml{,-base,-cpu,-blas,-metal}.0.dylib` ke satu direktori (~19 MB), mengganti rpath menjadi `@loader_path` dan id menjadi `@rpath/<nama>`, me-re-sign ad-hoc, lalu gagal bila masih ada dependensi absolut non-sistem atau `dlopen` dari `/` gagal. Build lama yang masih menautkan AMR ditolak skrip ini — bangun ulang dengan `build.sh`. Linux (`.so`, `$ORIGIN`, butuh `patchelf`) belum dites.
- **TTS** — direktori model Supertonic berisi `onnx/` dan `voice_styles/` (`TTS_MODEL_DIR`). Tuning: `TTS_STEPS`, `TTS_THREADS`, `TTS_MAX_UNIT_CHARS`.
- **ffmpeg** — untuk decode upload non-WAV dan encode mp3/opus/aac/flac (`FFMPEG_PATH`); default `ffmpeg` di `PATH`.
- **`ST4S_HOME`** — folder dasar (`~` diizinkan); default untuk binary = folder binary itu sendiri, untuk `bun run dev`/`start` tidak ada (default di atas berlaku apa adanya). Bila ada, path yang env-nya kosong diambil dari `lib/libcrispasr.dylib` (`.so` di Linux), `models/stt/{qwen3-asr-1.7b-q4_k.gguf,ggml-silero-v6.2.0.bin,ggml-tiny.bin}`, `models/tts/`, dan log production ke `logs/app.log` di bawahnya. Urutan: env eksplisit > `ST4S_HOME` > default; `FFMPEG_PATH` tidak ikut (ffmpeg tidak dibundel).
- **Cek saat boot** — server memeriksa semua path di atas dan ffmpeg sekali saat start; yang hilang dicatat satu baris log per item (`error` di production, `warn` di dev) dan tampil di field `deps` `GET /api/engines`. Server tetap jalan; engine baru gagal saat dipakai. Encode ffmpeg dihentikan setelah `TTS_FFMPEG_TIMEOUT_MS` tanpa audio baru (idle), bukan total durasi stream.
- **Self-test saat load** — setelah model dimuat, engine diuji di child yang sama sebelum dinyatakan `ready`. STT: klip bawaan (`server/engines/stt/selftest.wav`, ter-embed juga di binary) harus ditranskrip dengan kecocokan kata ≥ 60%, VAD harus menemukan suara di klip itu, dan hening 1 dtk harus menghasilkan teks kosong (dua cek VAD dilewati bila VAD dimatikan). TTS: frasa tetap harus menghasilkan audio yang tidak kosong, tanpa NaN, berdurasi wajar, dan tidak hening. Bila gagal, engine berstatus `error`, child dihentikan, alasan (cek yang gagal + tindakan) tampil di `/dev/engines`, dan request mendapat `503 engine_unavailable` sampai engine dimuat ulang; self-test yang tidak selesai dalam batas waktu (default STT 60 dtk, TTS 30 dtk; ubah lewat `ENGINE_SELFTEST_TIMEOUT_SEC`) diperlakukan sama. Log hanya berisi nama cek, durasi, lulus/gagal, dan skor — tidak pernah transkrip. Matikan dengan `ENGINE_SELFTEST=0`.
- **Memori** — child STT (decode CPU) memakai ~1,6 GB footprint setelah model dimuat dan ~3,45 GB sejak request pertama, lalu datar untuk audio 15 dtk maupun 60 dtk. Lonjakan sekali jalan itu berasal dari `libcrispasr`, yang memuat GGUF kedua kalinya untuk encoder audio (+1,4 GB) ditambah KV/compute (~0,4 GB). Dengan libcrispasr ber-patch (lihat atas) salinan kedua itu hilang: puncak footprint terukur turun dari ~3,48 GB ke ~2,08 GB dengan transkrip identik. Dengan lib tanpa patch dan `STT_GPU=1`, salinan itu ter-wire ke Metal di luar RSS dan bisa menghabiskan RAM bebas mesin 8 GB, jadi biarkan mati di host 8 GB. Child TTS sekitar 0,5 GB, jadi mesin 8 GB cukup untuk keduanya. Tiap upload yang sedang didecode juga memegang file + PCM float32 (±230 MB untuk audio 30 menit) dan antrean STT menyimpan PCM tiap job. Untuk host 8 GB disarankan `STT_MAX_QUEUE=2`, `V1_MAX_AUDIO_SEC=600`, dan `V1_DECODE_CONCURRENCY=1`–`2`.
- **Memory guard** — memantau RAM bebas (macOS: level memorystatus kernel + pressure; Linux: `MemAvailable`) dan bertindak bertingkat:
  - di bawah `MEM_GUARD_WARN_PCT` (30%), request baru `/api/v1/audio/*` dan warmup ditolak dengan `503 memory_pressure` + `Retry-After`. Penolakan baru berhenti setelah RAM bebas ≥ `MEM_GUARD_RECOVER_PCT` (40%) selama `MEM_GUARD_RECOVER_SEC` (30 dtk);
  - di bawah `MEM_GUARD_CRITICAL_PCT` (20%) atau saat pressure kernel kritis, engine idle di-unload lebih dulu, lalu engine yang sedang bekerja pada tick berikutnya;
  - di bawah `MEM_GUARD_EMERGENCY_PCT` (12%), STT lalu TTS di-unload segera;
  - sebelum memuat engine yang belum termuat (request `/api/v1/audio/transcriptions`/`speech` atau warmup), RAM bebas dicek terhadap `MEM_BUDGET_STT_MB` (2600) / `MEM_BUDGET_TTS_MB` (600). Bila kurang, request ditolak `503 memory_pressure` + `Retry-After` dengan pesan RAM yang dibutuhkan vs tersedia. Budget dipesan sampai engine siap atau gagal, jadi dua cold load bersamaan dihitung keduanya. Engine yang sudah termuat tidak dicek; `0` menonaktifkan cek engine itu.

  Engine tidak dimuat ulang otomatis; warmup manual setelah RAM pulih. Polling bersifat adaptif: tanpa timer saat tidak ada engine termuat, 10 dtk saat engine idle, dan 500 ms saat engine bekerja atau RAM menipis. Tiap unload tercatat di log dan Audit Log, dan statusnya muncul di field `memoryGuard` `GET /api/engines`, peringatan `/dev/engines`, dan badge sidebar. Nonaktifkan dengan `MEM_GUARD_ENABLED=false`.

## File health & penyelamat konteks agent

`/dev/file-health` (super-admin) memindai seluruh repo (kecuali `node_modules`, `build`, `.git`, cache) dan menilai setiap file teks:

- **Limit baris per peran** — route/handler 150, service 300, repository/query 250, schema 200, types 300, utility 200, config 100, test 400, page/component 300; hard limit global 500 baris / 20.000 karakter. Migration, generated, seed, fixture, lockfile, dan skill vendor (`.agents/`) dikecualikan. Aturan ada di `server/file-health/file-health.rules.ts`.
- **Risiko konteks agent** — estimasi token (≈ 4 karakter/token). ≥ 5.000 token = hati-hati, ≥ 15.000 = bahaya. Tujuannya mencegah AI agent membaca file seperti `bun.lock` secara utuh dan menghabiskan context window.

Agent bisa mengecek sendiri lewat tool MCP `check_file_health` (server `st4s-debug`): tanpa argumen mengembalikan ringkasan, file lewat/hampir limit, dan daftar file berbahaya; dengan `path` mengembalikan metrik + saran cara membaca file itu. REST: `GET /api/file-health` (filter `status`, `kind`, `hazard`, `search`, `sort`, `page`, `limit`, `refresh=true` untuk melewati cache 30 detik) dan `GET /api/file-health/file?path=`.

## Testing

```bash
bun run test                      # seluruh suite
bun test tests/auth-flow.test.ts  # satu file — sama amannya
```

Semua test ada di root `tests/` (mirror struktur `server/`). Setiap `bun test` dari root repo memuat preload `tests/setup/test-db.ts` (lewat `bunfig.toml`), yang:

- memaksa `NODE_ENV=test` (mengalahkan `.env`) dan mengarahkan `DATABASE_URL` ke **satu** database test;
- memakai `DATABASE_URL_TEST` bila diisi — ditolak bila nama database-nya tidak berakhiran `_test` atau sama dengan `DATABASE_URL` (tidak ada fallback ke database dev);
- bila `DATABASE_URL_TEST` kosong, menyalakan PostgreSQL test bawaan di `./data/pg-test` (database `st4s_test`, terpisah dari `./data/pg` milik `bun run dev`, bisa jalan bersamaan) dan mematikannya saat run selesai/dihentikan. Run kedua pada cluster yang sama ditolak ("Test lain sedang berjalan");
- menjalankan migrasi ke database test di setiap run (idempotent, diserialkan dengan advisory lock).

`server/db/index.ts` menolak koneksi dalam proses test yang tidak melewati preload ini (mis. `NODE_ENV=test bun run <script>`).

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

MIT — lihat [LICENSE](LICENSE).
