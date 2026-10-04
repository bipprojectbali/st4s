# CLAUDE.md — makuro-template

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

### Format Wajib

```ts
// Halaman publik (landing, login, dll)
export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Judul Halaman — Makuro' },
    { name: 'description', content: 'Deskripsi singkat halaman ini, 120–160 karakter.' },
  ];
}

// Halaman app/admin (tidak diindex search engine, tapi title tetap wajib)
export function meta() {
  return [{ title: 'Nama Halaman — Makuro' }];
}
```

### Konvensi Title

- Format: `"Nama Halaman — Brand"` — nama halaman di depan, brand di belakang.
- Halaman publik: sertakan `description` (120–160 karakter, deskriptif, tidak duplikat).
- Halaman admin/app: cukup `title`, tidak perlu `description` (tidak diindex).
- Root (`root.tsx`) wajib punya `meta()` sebagai **fallback global** — halaman yang tidak define meta sendiri akan fallback ke sini.

### Favicon

- Favicon didefinisikan secara hardcoded di `root.tsx` `<head>` sebagai `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />`.
- File favicon ada di `public/favicon.svg` — jangan ganti tanpa alasan, ini brand identity.
- Jangan duplikasi favicon lewat `meta()` — sudah cukup di hardcoded.

### Halaman Publik — OG Tags (Open Graph)

Untuk halaman yang bisa dishare (home, landing page):

```ts
export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Makuro — Fullstack Template' },
    { name: 'description', content: '...' },
    { property: 'og:title', content: 'Makuro — Fullstack Template' },
    { property: 'og:description', content: '...' },
    { property: 'og:type', content: 'website' },
  ];
}
```

**Blocker:** route yang dirender tanpa `export function meta()` → STOP sebelum commit. Redirect-only routes (tidak punya `default export` komponen) dikecualikan.

## Mobile-Friendly — Standar Ketat Wajib Dipatuhi Agent

App ini harus bisa diakses dengan baik di mobile. Admin console tetap primary desktop, namun **tidak boleh rusak di mobile**. Agent wajib menerapkan semua aturan di bawah ini secara proaktif — bukan menunggu diminta. Standar ini berlaku untuk setiap halaman baru maupun yang dimodifikasi.

### 1. Navigasi — AppShell dengan Mobile Header Wajib

Jangan pernah menempatkan `<Burger>` sebagai elemen `pos="fixed"` floating tanpa `AppShell.Header`. Pola yang wajib dipakai:

```tsx
<AppShell
  header={{ height: { base: 52, sm: 0 } }}  // header hanya muncul di mobile
  navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
>
  <AppShell.Header withBorder={false} hiddenFrom="sm">
    <Group h="100%" px="md" gap="sm">
      <Burger opened={mobileOpened} onClick={toggleMobile} size="sm" aria-label="Toggle navigation" />
      <Text fw={700}>Nama App</Text>
    </Group>
  </AppShell.Header>
  <AppShell.Navbar>...</AppShell.Navbar>
  <AppShell.Main>...</AppShell.Main>
</AppShell>
```

**Blocker:** Burger floating fixed tanpa AppShell.Header → STOP.

### 2. Tabel — Kolom Wajib Responsif

Semua tabel harus scrollable horizontal DAN menyembunyikan kolom tidak esensial di mobile:

```tsx
// Wrapper scroll — wajib ada
<Box style={{ overflowX: 'auto' }}>
  <Table>
    <Table.Thead>
      <Table.Tr>
        <Table.Th>Kolom Penting</Table.Th>
        <Table.Th visibleFrom="sm">Kolom Sekunder</Table.Th>  {/* hidden di mobile */}
      </Table.Tr>
    </Table.Thead>
    <Table.Tbody>
      <Table.Tr>
        <Table.Td>...</Table.Td>
        <Table.Td visibleFrom="sm">...</Table.Td>  {/* hidden di mobile */}
      </Table.Tr>
    </Table.Tbody>
  </Table>
</Box>
```

Alternatif: `<Table.ScrollContainer minWidth={640}>` bila semua kolom harus tampil.

**Untuk tabel dengan 4+ kolom data kaya — wajib gunakan card/list view di mobile:**

```tsx
{/* Desktop: tabel biasa */}
<Box style={{ overflowX: 'auto' }} visibleFrom="sm">
  <Table>...</Table>
</Box>

{/* Mobile: card list — semua data terlihat tanpa scroll horizontal */}
<Stack gap="xs" hiddenFrom="sm">
  {rows.map((r) => (
    <Paper key={r.id} withBorder p="sm" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          {/* Data primer: path/nama/judul — truncate dengan minWidth: 0 */}
          <Text truncate style={{ minWidth: 0 }}>{r.path}</Text>
          {/* Data sekunder: timestamp, IP, ID — dimmed, kecil */}
          <Text size="xs" c="dimmed">{fmt(r.createdAt)}</Text>
        </Stack>
        {/* Aksi: delete, edit — flexShrink: 0 agar tidak ikut dipersempit */}
        <ActionIcon style={{ flexShrink: 0 }}>...</ActionIcon>
      </Group>
    </Paper>
  ))}
</Stack>
```

Pola ini berlaku untuk semua halaman log, tabel user, dan tabel data apapun dengan ≥4 kolom.

**Prioritas kolom yang wajib tampil di mobile:** kolom identitas utama (nama/path) + status + aksi.
**Kolom yang boleh disembunyikan di mobile dengan `visibleFrom="sm"`:** IP, User Agent, User ID, timestamp sekunder, kolom detail.

**Blocker:** Tabel ≥4 kolom tanpa card view mobile DAN tanpa `overflowX: 'auto'` → STOP.

### 3. Page Header — Tombol Action Wajib Wrap

Header halaman yang berisi judul + tombol-tombol wajib menggunakan `wrap="wrap"`:

```tsx
// ✅ Benar — buttons wrap ke bawah bila tidak muat
<Group justify="space-between" align="flex-start" wrap="wrap">
  <Title order={3}>Judul Halaman</Title>
  <Group gap="xs" wrap="wrap" justify="flex-end">
    <Button>Clear All</Button>
    <Button>Purge 30d+</Button>
    <Button>Refresh</Button>
  </Group>
</Group>

// ❌ Salah — buttons overflow layar di mobile
<Group justify="space-between" wrap="nowrap">
```

**Blocker:** Header dengan `wrap="nowrap"` yang berisi tombol-tombol → STOP.

### 4. Layout & Spacing

- Gunakan Mantine `Grid`, `SimpleGrid`, `Stack` dengan breakpoints — **bukan** fixed-width pixel.
- `width: 800px`, `minWidth: 600px` pada container utama → gunakan `maw` + `w="100%"` sebagai gantinya.
- Padding halaman: minimal `p="sm"` di mobile — gunakan `p={{ base: 'sm', md: 'md' }}` bila perlu.
- Kolom grid yang tidak muat di mobile → `cols={{ base: 1, sm: 2, md: 3 }}`.

### 5. Touch Targets

- Tombol aksi utama: minimum `size="sm"` (44px touch area).
- `ActionIcon` kecil di dalam tabel: boleh `size="xs"` karena tabel sudah scrollable.
- Jarak antar touch target: minimal `gap="xs"`.
- Hindari link/button berdekatan tanpa jarak yang cukup.

### 6. Form & Input

- Set `inputMode` yang sesuai: `inputMode="email"`, `inputMode="numeric"`, `inputMode="url"`.
- Jangan set `font-size` di bawah 16px pada input — browser mobile akan auto-zoom.
- Mantine input component sudah handle ini secara default, jangan override ke ukuran lebih kecil.

**Cara agent menerapkan:** Bayangkan layar 375px lebar (iPhone SE). Apakah semua elemen visible dan bisa di-tap? Apakah ada overflow horizontal tanpa scroll? Apakah burger tidak menimpa konten? Jika ada masalah → perbaiki sebelum commit.

**Blocker (semua harus dipenuhi sebelum commit):**
- ❌ Burger floating tanpa AppShell.Header
- ❌ Tabel tanpa scroll wrapper
- ❌ Page header `wrap="nowrap"` dengan banyak tombol
- ❌ Container fixed-width melampaui 375px tanpa overflow handling

## Binary Build — Catatan Penting untuk Agent

Saat bekerja dengan `bun build --compile --asset`:

- `Bun.isStandaloneExecutable` — API resmi untuk deteksi binary mode (boolean). **Jangan** gunakan regex pada `Bun.main`.
- `--asset ./build/client` meng-embed files sebagai `client/` di VFS (**strip satu level direktori induk** — `build/` dihapus).
- `import.meta.dir` dalam compiled binary = `/$bunfs/root` (bukan path disk tempat binary berada).
- `Bun.file(path).exists()` bekerja normal untuk embedded VFS files.
- Path CLIENT_DIR yang benar:
  ```ts
  const CLIENT_DIR = Bun.isStandaloneExecutable
    ? path.join(import.meta.dir, 'client') + '/'          // binary: /$bunfs/root/client/
    : path.join(import.meta.dir, '../build/client') + '/'; // script: ../build/client/
  ```
- SSR bundle di-embed via **static import** (`import * as ssrBuild from '../build/server/index.js'`) — Bun mengikuti static import dan mem-bundle seluruh deps ke binary.
- `Bun.embeddedFiles` berguna untuk debug: menampilkan path dan ukuran semua file yang di-embed.

## Stack

- **Runtime:** Bun
- **Server:** Elysia
- **Frontend:** React Router v8 SSR, Mantine v9
- **DB:** PostgreSQL + Drizzle ORM
- **Auth:** Better Auth
- **Test runner:** `bun run test` (bun:test)

## Test

- Jalankan: `bun run test` — script ini yang men-set `NODE_ENV=test`. **Jangan** jalankan `bun test tests` langsung: tanpa `NODE_ENV=test`, `server/db/index.ts` memakai `DATABASE_URL` (dev/prod), bukan test DB.
- Lokasi test: semua di root `tests/**/*.test.ts`, mirror struktur `server/` (`tests/api/`, `tests/db/`, `tests/mcp/`, `tests/middleware/`, sisanya di `tests/`). Import ke source relatif ke `server/` (mis. `../../server/api/admin` dari `tests/api/`, `../server/roles` dari `tests/`).
- **Test database:** set `DATABASE_URL_TEST` di `.env` — ketika `NODE_ENV=test`, `server/db/index.ts` otomatis pakai `DATABASE_URL_TEST` bukan `DATABASE_URL`. Jika tidak di-set, fallback ke `DATABASE_URL` (berbahaya untuk data produksi).
- Migrasi test DB: `DATABASE_URL=<url_test> bun run db:migrate`
- Migrasi baru wajib dijalankan ke **dua** DB sebelum test: `bun run db:migrate` (dev) dan `DATABASE_URL=$DATABASE_URL_TEST bun run db:migrate` (test).
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
- **Versi** hanya dari `package.json` (`server/app-info.ts`); jangan hardcode di tempat lain.

## CHANGELOG.md — Ditulis Agent

- Setiap merge/push fitur: tambahkan poin ke `## [Unreleased]` di `CHANGELOG.md` (section `Added`/`Changed`/`Fixed`/`Removed`, bahasa Indonesia, sudut pandang user) di commit yang sama.
- Saat deploy: ganti `## [Unreleased]` menjadi `## [x.y.z] - YYYY-MM-DD` sesuai versi `package.json`. Badge `/dev/changelog` kuning = versi berjalan belum punya entry.
- Halaman `/dev/changelog` mem-parse file ini (`server/changelog.ts`); baris yang tidak dikenali tetap tampil di section "Lainnya", jadi jaga formatnya.
- Vite tidak bisa mengimpor `.md`: dev membaca file dari disk, `server/prod.ts` meng-embed dan mendaftarkannya ke `globalThis`. Perubahan CHANGELOG baru terlihat di prod setelah rebuild.

## Konvensi Halaman `/dev` & Error

- **Menambah halaman `/dev` baru = lima tempat:** `app/routes.ts`, `NAV` di `app/routes/super/layout.tsx`, `QuickLinks` overview, `CONSOLE_PAGES` di `app/components/landing/landing.content.ts` + `CONSOLE_PAGE_COUNT` di `server/landing-stats.ts` (test menjaga ketiganya sinkron), dan badge di `server/sidebar-badges.ts` (nada `alert` untuk hal yang butuh tindakan, `info` untuk skala; satu query agregat murah, gagal lunak).
- **Pola halaman konsol:** loader SSR + `toJson` + react-query `initialData`; komponen bersama di `app/components/logs/*` (StatTile, BreakdownPanel, LogCells, DetailParts, TruncatedText); tabel desktop + kartu mobile; drawer detail; aksi lewat hook `use*Actions` dengan `modals.openConfirmModal` dan `notifications`; aksi berhak istimewa dipanggil `audit()` di server dan labelnya ditambahkan ke `ACTION_META` di `app/lib/audit-api.ts`.
- **Tooltip di dalam `Menu.Target` mematikan klik** — jangan bungkus target menu dengan Tooltip.
- **Error boundary:** setiap layout area (`super/admin/user`) merender `AppFrame` lewat helper `Frame` yang dipakai ulang oleh `ErrorBoundary` bersama `AreaErrorBoundary`, sehingga halaman yang gagal tetap punya sidebar. Halaman baru tidak perlu boundary sendiri; jangan hapus `ErrorBoundary` di layout. Kode status/pesan error halaman berasal dari katalog `app/lib/error-page.ts`.
- **README.md dilayani publik** di `/README.md` dan `/llms*.txt` (satu sumber, juga ter-embed ke binary). Jangan tulis rahasia, hostname internal, atau kredensial contoh yang valid di README; test `tests/readme-endpoint.test.ts` memindainya. Fitur baru yang mengubah kontrak publik wajib menambah/menyunting bagian README yang relevan di commit yang sama.

## Build & Deploy — Verifikasi Wajib

- `bun run typecheck` harus **nol** error tanpa filter apa pun (deklarasi untuk modul tanpa tipe ada di `server/types/*.d.ts`; `build/server/index.js` dideklarasikan di `ssr-build.d.ts` agar typecheck tidak bergantung pada hasil build).
- Perubahan yang menyentuh `server/`, `app/entry.server.tsx`, `app/root.tsx`, logger, atau skrip build → jalankan `bun run smoke:prod` **dan** `bun run smoke:binary` sebelum lapor selesai. Keduanya build, boot server di port acak dengan `NODE_ENV=production`, menjalankan 22 pemeriksaan black-box (`scripts/smoke-server.checks.ts`), dan exit ≠ 0 bila gagal. Skrip mengabaikan `PORT`/`NODE_ENV` dari `.env` — jangan pernah mengarahkan pemeriksaan ke port dev server user.
- **Bundle SSR ≠ proses Bun:** modul `@server/*` yang diimpor dari `app/` dibundel Vite menjadi salinan kedua di `build/server/index.js`. Singleton proses (`logger`, `logBuffer`) disimpan di `globalThis` agar kedua salinan memakai satu instance; ikuti pola itu untuk singleton baru (scheduler, cache, koneksi). `app/entry.server.tsx` melapor lewat `processLog` dari `@server/ssr-log`, bukan mengimpor logger.
- **pino-roll v4** memakai satu objek opsi (`{ file, frequency: 'daily', size, limit, mkdir }`); `frequency: '1d'` atau bentuk `build(path, opts)` membuat `bun run start` gagal boot.
- Binary men-default `NODE_ENV=production` tetapi menghormati `.env` di direktori kerja (Bun auto-load) dan memperingatkan bila bukan production. Menambah pemeriksaan smoke = tambah entri di `SMOKE_CHECKS` (nama unik, path absolut) — `tests/smoke-server.test.ts` menjaganya.

## Konvensi Engine Suara (s4s)

- **Kontrak** `SttEngine`/`TtsEngine` + `EngineBusyError` ada di `server/engines/types.ts`. Route hanya memanggil `getStt()`/`getTts()` dari `server/engines/registry.ts` (slot di `globalThis.__s4sEngines`, agar salinan bundle SSR memakai instance yang sama); slot kosong → `503 engine_unavailable`.
- **Lazy & boot:** engine tidak memuat apa pun sampai request pertama/warmup. `server/dev.ts` dan `server/prod.ts` memanggil `bootEngines()` + `exitOnShutdownSignals()` (SIGINT/SIGTERM → unload, batas 5 dtk). Test **tidak pernah** mem-boot engine asli — pasang fake lewat `setEngines({ stt, tts })` (pola `tests/v1/fake-stt.ts`) dan kosongkan lagi di `afterAll`.
- **Satu child process per engine:** FFI `libcrispasr` sinkron dan ONNX berat, jadi keduanya dijalankan di child agar event loop server tidak beku. Tiap engine memproses satu job sekaligus dengan antrean serial; antrean penuh → `EngineBusyError` → `429 engine_busy` + `Retry-After` (bukan 503).
- **Streaming STT:** Qwen3-ASR tidak punya callback per token, jadi `transcript.text.delta` = satu delta per potongan VAD. `STT_MAX_CHUNK_SEC` 30 vs 8 terukur RTF 0,45 vs 0,31, tetapi kualitas transkrip turun di 8 — default tetap 30; jangan turunkan demi delta lebih sering tanpa mengukur ulang kualitas.
- **Memori (target mesin 8 GB):** child STT (decode CPU) ~1,6 GB footprint setelah model dimuat, ~3,45 GB sejak request pertama (libcrispasr memuat GGUF kedua kalinya untuk audio encoder, +1,4 GB, plus ~0,4 GB KV/compute); `STT_GPU=1` memindahkan salinan itu ke Metal di luar RSS dan bisa menghabiskan RAM bebas di host 8 GB — biarkan mati di sana. TTS ~460 MB. Sebelum menjalankan model asli (probe, `S4S_REAL_ENGINE=1 bun test tests/e2e/v1-real.test.ts`), ambil lock global `until mkdir /tmp/s4s-model.lock 2>/dev/null; do sleep 5; done`, pastikan `memory_pressure | tail -1` ≥ 25% free, pakai `timeout`, dan selalu `rmdir` lock lewat `trap`.
- **Binary:** child dijalankan dengan me-re-exec binary itu sendiri sebagai `--s4s-engine-child stt|tts` (`server/engines/child-argv.ts`); dari source memakai `bun <entry>`. `bun build --compile` tidak meng-embed `libonnxruntime.1.dylib`/`.so.1`, jadi TTS di binary butuh library itu di samping binary + `DYLD_LIBRARY_PATH` (`LD_LIBRARY_PATH` di Linux, belum dites). STT tidak butuh apa-apa tambahan.
- **Error OpenAI hanya di `/api/v1`:** `server/api-error.ts` dan plugin (rate limit, maintenance, API key) bercabang lewat `isV1Path()` dan memakai `v1ErrorBody()`/`v1Error()` dari `server/v1/errors.ts`. Route `/api/*` lain tetap `{ error, code, status, requestId }` — jangan campur keduanya.
- **Route v1 baru** wajib dipetakan scope-nya di `server/api-keys/scopes.ts` (`stt:transcribe`, `tts:speak`, atau publik di `isPublicRead`) + assertion di `tests/api-keys/scopes.test.ts`.
- **Privasi:** log engine dan v1 hanya berisi metrik (durasi, ukuran, RTF, model, status) — **tidak pernah** transkrip, teks input, atau byte audio, termasuk di pesan error dan audit.
