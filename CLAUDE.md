# CLAUDE.md — st4s

Aturan project ini menambah/override global `~/.claude/CLAUDE.md`.

## UI Framework — Mantine Wajib Dipakai

Project ini menggunakan **Mantine** (`@mantine/core`, `@mantine/hooks`, `@mantine/modals`) sebagai UI framework utama.

**Wajib pakai Mantine untuk semua UI element:**
- Konfirmasi/dialog → `modals.openConfirmModal()` dari `@mantine/modals` — **bukan** `window.confirm()`
- Alert/notifikasi → Mantine `notifications.show()` — **bukan** `window.alert()`
- Semua input, button, badge, tooltip, loader, modal, dll → pakai komponen Mantine

**Setup yang sudah ada di project:**
- `ModalsProvider` sudah wrap app di `app/root.tsx`
- Style modals sudah tercakup dalam `@mantine/core/styles.css` — **jangan** import `@mantine/modals/styles.css` (tidak ada di package ini)
- Gunakan `import { modals } from '@mantine/modals'` untuk confirm dialog

**Blocker:** memakai `window.confirm`/`window.alert`/native HTML element yang sudah di-cover Mantine → STOP sebelum commit; ganti dengan komponen Mantine.

## UX Production-Ready — Wajib Dipatuhi Agent

Ini adalah standar kualitas UX yang membuat app terasa selesai dan layak produksi. Agent wajib menerapkan ini secara **proaktif** tanpa menunggu user mengingatkan.

### 1. Konfirmasi untuk Aksi Destruktif / Irreversible
Setiap aksi yang menghapus data, mengakhiri sesi, atau susah dibatalkan **wajib** tampilkan confirm dialog via `modals.openConfirmModal()` sebelum dieksekusi.

Contoh yang **wajib** ada confirm:
- Sign out / logout → confirm "Kamu akan keluar dari akun ini"
- Hapus item (row, post, user) → confirm "Data ini akan dihapus permanen"
- Purge / bulk delete → confirm dengan deskripsi dampak
- Perubahan role user (escalate/demote) → confirm
- Ban / unban user → confirm

**Blocker:** aksi destruktif tanpa confirm dialog → STOP sebelum commit.

### 2. Loading State pada Setiap Aksi Async
Button yang memicu request async **wajib** punya `loading` prop / spinner selama request berlangsung. User tidak boleh dibiarkan tanpa feedback.

### 3. Feedback Sukses / Gagal
Setelah aksi async selesai:
- Sukses → tampilkan notifikasi singkat atau update UI secara visible (refresh data, badge berubah, dll)
- Gagal → tampilkan pesan error yang jelas (bukan diam-diam gagal)
- Gunakan Mantine `notifications.show()` jika feedback perlu muncul di luar konteks form/button

### 4. Empty State yang Informatif
Tabel / list kosong → jangan biarkan blank. Tampilkan pesan bermakna seperti "Belum ada data" dengan ikon atau deskripsi singkat.

### 5. Disabled State yang Kontekstual
Button yang tidak bisa dipakai (misal: "Purge" saat tidak ada data) → `disabled` dengan alasan yang jelas dari konteks UI (tooltip atau label).

### 6. Konsistensi Bahasa UI
- Label tombol: imperatif dan spesifik — "Hapus Visit Log", bukan "OK" atau "Submit"
- Pesan confirm: jelaskan dampak nyata — "Semua log lebih dari 30 hari akan dihapus permanen"
- Pesan error: actionable — "Gagal menyimpan. Coba lagi." bukan "Error"

**Cara agent menerapkan:** Setiap kali menulis fitur baru yang mengandung aksi async, delete, atau state change penting → langsung terapkan standar di atas tanpa menunggu instruksi. Ini bukan optional — ini adalah definisi "fitur selesai" di project ini.

## SEO & Meta Tags — Wajib di Setiap Route

Setiap route yang dirender (bukan redirect-only) **wajib** punya `export function meta()`. Ini berlaku untuk route halaman maupun layout route. Tanpa ini, browser tab kosong dan search engine tidak mendapat sinyal apapun.

Format, konvensi title, favicon, dan OG tags: `.claude/rules/seo-meta.md`.

**Blocker:** route yang dirender tanpa `export function meta()` → STOP sebelum commit. Redirect-only routes (tidak punya `default export` komponen) dikecualikan.

## Mobile-Friendly — Standar Ketat Wajib Dipatuhi Agent

App ini harus bisa diakses dengan baik di mobile. Admin console tetap primary desktop, namun **tidak boleh rusak di mobile**. Agent wajib menerapkan semua aturan di bawah ini secara proaktif — bukan menunggu diminta. Standar ini berlaku untuk setiap halaman baru maupun yang dimodifikasi.

Pola wajib per elemen (AppShell header, tabel + card view, page header, layout, touch target, input): `.claude/rules/mobile-ui.md`.

**Cara agent menerapkan:** Bayangkan layar 375px lebar (iPhone SE). Apakah semua elemen visible dan bisa di-tap? Apakah ada overflow horizontal tanpa scroll? Apakah burger tidak menimpa konten? Jika ada masalah → perbaiki sebelum commit.

**Blocker (semua harus dipenuhi sebelum commit):**
- ❌ Burger floating tanpa AppShell.Header
- ❌ Tabel tanpa scroll wrapper
- ❌ Page header `wrap="nowrap"` dengan banyak tombol
- ❌ Container fixed-width melampaui 375px tanpa overflow handling

## Stack

- **Runtime:** Bun
- **Server:** Elysia
- **Frontend:** React Router v8 SSR, Mantine v9
- **DB:** PostgreSQL + Drizzle ORM
- **Auth:** Better Auth
- **Test runner:** `bun run test` (bun:test)

## Test

- Jalankan: `bun run test` atau `bun test <file>` dari root repo — keduanya aman.
- Lokasi test: semua di root `tests/**/*.test.ts`, mirror struktur `server/` (`tests/api/`, `tests/db/`, `tests/mcp/`, `tests/middleware/`, sisanya di `tests/`). Import ke source relatif ke `server/` (mis. `../../server/api/admin` dari `tests/api/`, `../server/roles` dari `tests/`).
- **Test database dijaga sistem:** `bunfig.toml` → preload `tests/setup/test-db.ts` memaksa `NODE_ENV=test`, menaruh satu database `*_test` di `DATABASE_URL` (`DATABASE_URL_TEST`, harus berakhiran `_test` dan ≠ `DATABASE_URL`; kosong = cluster bawaan `./data/pg-test`) lalu memigrasikannya otomatis. `server/db/index.ts` menolak proses test tanpa marker preload. Aturan ada di `server/db/test-guard.ts` — jangan buat koneksi DB di test dari env lain selain `DATABASE_URL`.
- **Autentikasi di integration test — pakai `spyOn`, bukan `mock.module`:** stub `spyOn(auth.api, 'getSession')` + `spyOn(rolesMod, 'resolveUserRole')` lalu biarkan guard asli bekerja (pola: `tests/api/posts.test.ts`, `tests/api/me-api-keys.test.ts`). `mock.module('../../server/guard', …)` hanya boleh untuk route yang semata memakai `requireRole` (pola: `tests/api/api-keys-api.test.ts`); mock yang mengganti `resolveActor` **bocor ke file test lain** dalam satu run dan membuat test tak terkait gagal. Faktor pada `mock.module` juga tidak boleh merujuk variabel modul (hoisting) — pakai literal atau `globalThis`.
- User test ber-role `super-admin` akan **diturunkan otomatis** oleh `resolveUserRole` (sumber kebenarannya `SUPER_ADMIN_EMAILS`); seed `admin` untuk skenario admin, atau stub `resolveUserRole`.
- Identitas API key disimulasikan dengan `setApiKeyIdentity(request, {...})` dari `server/api-keys/identity.ts`; hook `onAfterResponse` berjalan setelah `app.handle()` resolve — `await Bun.sleep(20)` sebelum `flushUsage()`.
- Cleanup: gunakan `beforeEach`/`afterEach` untuk insert/delete row test spesifik (bukan `DELETE FROM table` global)
- Smoke test runtime: **jangan** `pkill` dev server user. Jalankan instance sendiri `PORT=3077 bun run server/dev.ts`, simpan PID, kill PID itu saja. Skrip probe sementara di root project (untuk resolusi modul) wajib dihapus setelah dipakai.

## Konvensi Server (Elysia, API, error)

- **Urutan hook:** `derive` di route berjalan pada fase transform, **sebelum** `onBeforeHandle` global. Plugin yang harus menyuntik identitas untuk route ber-`derive` (contoh: `server/api-keys/plugin.ts`) memakai `onRequest`. Hook lain hanya berlaku untuk route yang didaftarkan **setelahnya** — urutan di `server/api/index.ts` adalah kontrak: `apiErrorPlugin → rateLimitPlugin → maintenancePlugin → apiKeyPlugin → mount auth → router`.
- **Bentuk error API wajib seragam:** `{ error, code, status, requestId }`. Handler mengembalikan `status(4xx, { error, code? })`; jangan `throw` string atau kirim stack. Error tak tertangkap otomatis jadi 500 JSON ber-`requestId` lewat `server/api-error.ts` (pesan disembunyikan di produksi). Untuk pesan ke user pakai bahasa Indonesia yang actionable.
- **`.mount(auth.handler)` adalah catch-all** untuk semua `/api/*` yang tidak cocok — mount tetap dibungkus agar hanya `/api/auth/*` yang diteruskan (lihat `index.ts`). Jangan menambah mount lain tanpa pembungkus serupa.
- **Route API baru wajib dipetakan ke scope** di `server/api-keys/scopes.ts` (`requiredScope`), atau eksplisit `null` bila tidak boleh diakses API key, atau `isPublicRead` bila publik — lalu tambahkan assertion di `tests/api-keys/scopes.test.ts`. Tanpa pemetaan, pemanggil API key mendapat 403.
- **Better Auth apiKey:** `auth.api.createApiKey/updateApiKey` dipanggil **tanpa** `headers`; scope dicek sendiri (plugin melaporkan scope kurang sebagai `KEY_NOT_FOUND`); total pemakaian dari `api_key_usage`, bukan `requestCount`.
- **Tanggal di fragmen `sql` mentah:** kirim `${d.toISOString()}::timestamp`, bukan objek `Date` (fragmen raw tidak mendapat pemetaan kolom).
- **Request non-halaman sebelum SSR:** probe browser (`/favicon.ico`, `/.well-known/`, `apple-touch-icon`) ditangani `server/http-probes.ts`; dokumentasi agent (`/README.md`, `/llms*.txt`) oleh `server/readme.ts`. Keduanya harus tetap masuk daftar pengecualian `visitor.ts` dan `settings-maintenance.ts`. Tambahkan di sana bila ada path statis baru, jangan biarkan jatuh ke React Router (menghasilkan stack trace 404).
- **Dev server `--hot`** tidak selalu memuat ulang plugin Elysia baru — minta user restart `bun run dev` setelah menambah plugin/hook.
- **Tooling DB dev** (`db:migrate|push|studio`, `bun run st4s`) lewat `scripts/dev-db.ts`: menolak DB `*_test` (DB test hanya dimigrasikan preload test, lihat "Test"), `DATABASE_URL` kosong → PostgreSQL bawaan (`acquireLocalPg`). Jangan kembalikan URL fallback di `drizzle.config.ts`.
- **Versi** hanya dari `package.json` (`server/app-info.ts`); jangan hardcode di tempat lain.
- **Error OpenAI hanya di `/api/v1`:** `server/api-error.ts` dan plugin (rate limit, maintenance, API key) bercabang lewat `isV1Path()` dan memakai `v1ErrorBody()`/`v1Error()` dari `server/v1/errors.ts`. Route `/api/*` lain tetap `{ error, code, status, requestId }` — jangan campur keduanya.

## CHANGELOG.md — Ditulis Agent

- Setiap merge/push fitur: tambahkan poin ke `## [Unreleased]` di `CHANGELOG.md` (section `Added`/`Changed`/`Fixed`/`Removed`, bahasa Indonesia, sudut pandang user) di commit yang sama.
- Saat deploy: ganti `## [Unreleased]` menjadi `## [x.y.z] - YYYY-MM-DD` sesuai versi `package.json`. Badge `/dev/changelog` kuning = versi berjalan belum punya entry.
- Halaman `/dev/changelog` mem-parse file ini (`server/changelog.ts`); baris yang tidak dikenali tetap tampil di section "Lainnya", jadi jaga formatnya.
- Vite tidak bisa mengimpor `.md`: dev membaca file dari disk, `server/prod.ts` meng-embed dan mendaftarkannya ke `globalThis`. Perubahan CHANGELOG baru terlihat di prod setelah rebuild.

## Build & Deploy — Verifikasi Wajib

- `bun run typecheck` harus **nol** error tanpa filter apa pun (deklarasi untuk modul tanpa tipe ada di `server/types/*.d.ts`; `build/server/index.js` dideklarasikan di `ssr-build.d.ts` agar typecheck tidak bergantung pada hasil build).
- Perubahan yang menyentuh `server/`, `app/entry.server.tsx`, `app/root.tsx`, logger, atau skrip build → jalankan `bun run smoke:prod` **dan** `bun run smoke:binary` sebelum lapor selesai. Keduanya build, boot server di port acak dengan `NODE_ENV=production`, menjalankan pemeriksaan black-box di `SMOKE_CHECKS` (`scripts/smoke-server.checks.ts`), dan exit ≠ 0 bila gagal. Skrip mengabaikan `PORT`/`NODE_ENV` dari `.env` — jangan pernah mengarahkan pemeriksaan ke port dev server user.
- **Bundle SSR ≠ proses Bun:** modul `@server/*` yang diimpor dari `app/` dibundel Vite menjadi salinan kedua di `build/server/index.js`. Singleton proses (`logger`, `logBuffer`) disimpan di `globalThis` agar kedua salinan memakai satu instance; ikuti pola itu untuk singleton baru (scheduler, cache, koneksi). `app/entry.server.tsx` melapor lewat `processLog` dari `@server/ssr-log`, bukan mengimpor logger.
- **pino-roll v4** memakai satu objek opsi (`{ file, frequency: 'daily', size, limit, mkdir }`); `frequency: '1d'` atau bentuk `build(path, opts)` membuat `bun run start` gagal boot.
- Binary men-default `NODE_ENV=production` tetapi menghormati `.env` di direktori kerja (Bun auto-load) dan memperingatkan bila bukan production. Menambah pemeriksaan smoke = tambah entri di `SMOKE_CHECKS` (nama unik, path absolut) — `tests/smoke-server.test.ts` menjaganya.

## Aturan Domain — `.claude/rules/`

Detail per area ada di `.claude/rules/*.md`. Claude Code memuatnya otomatis saat Read/Edit/Write file yang cocok dengan `paths:`-nya. Bila mengerjakan area tersebut tanpa membuka file yang cocok (mis. hanya menjalankan perintah), **baca file aturannya dulu**:

- `engines.md` — engine STT/TTS, `/api/v1`, libcrispasr, memori 8 GB, **probe model asli (lock + watchdog RAM)**, privasi log. Wajib dibaca sebelum menjalankan model asli. Glob: `server/{engines,v1,audio,text,memory-guard}/**`, `scripts/crispasr/**`, `tests/{engines,v1,e2e,audio}/**`, `server/{dev,prod}.ts`, komponen/halaman engines & playground.
- `binary-build.md` — `bun build --compile --asset`, VFS, `CLIENT_DIR`. Glob: `server/prod.ts`, `server/binary-entry.ts`, `scripts/**`, `package.json`, `Dockerfile`.
- `dev-console.md` — menambah halaman `/dev` (lima tempat), pola halaman konsol, error boundary, README yang dilayani publik. Glob: `app/routes.ts`, `app/routes/**`, `app/components/**`, `app/lib/**`, `server/{sidebar-badges,sidebar,landing-stats,readme}.ts`, `README.md`.
- `seo-meta.md` — detail `meta()`. Glob: `app/root.tsx`, `app/routes.ts`, `app/routes/**/*.tsx`.
- `mobile-ui.md` — detail pola mobile. Glob: `app/**/*.tsx`.
