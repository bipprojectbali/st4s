---
paths:
  - "server/prod.ts"
  - "server/binary-entry.ts"
  - "server/engines/child-argv.ts"
  - "scripts/**"
  - "package.json"
  - "Dockerfile"
---

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
- **onnxruntime di binary:** Bun mengekstrak `onnxruntime_binding.node` ke `$TMPDIR`, jadi `@rpath/libonnxruntime.1.dylib`-nya tak ketemu. Child TTS memanggil `preloadOrt()` (`server/engines/tts/ort-preload.ts`) sebelum `import('./supertonic')`: `dlopen` `<st4sLibDir()>/libonnxruntime.1.dylib` (`.so.1` di Linux, belum dites) lewat `bun:ffi` agar dyld mencocokkan install name — tanpa `DYLD_LIBRARY_PATH`. File hilang → error menyebut path + `st4s doctor`. Sumber untuk bundle: `node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/libonnxruntime.1.dylib`. Jangan tambah fallback env.

Child engine di binary (re-exec `--st4s-engine-child`): lihat `.claude/rules/engines.md` bagian **Binary**.

## Entry binary & subcommand (`server/binary-entry.ts`, `server/cli/*`)

- **Urutan entry adalah kontrak:** `--st4s-engine-child` dicek **paling awal** (child mewarisi env parent, tidak memuat `.env` lagi) → `loadHomeEnv()` memuat `<ST4S_HOME>/.env` (`process.loadEnvFile`, env asli menang) → subcommand `init|doctor|migrate|models|--version|help` → server. Kata tak dikenal = exit 2; flag tak dikenal = server.
- **Flag build wajib** di ketiga `build:binary*` (dijaga `tests/cli/dispatch.test.ts`): `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` (`.env` cwd diabaikan), `--asset ./server/db/migrations` (VFS `/$bunfs/root/migrations`, lihat `migrationsFolder()`), dan `--define process.env.NODE_ENV=process.env.NODE_ENV` — tanpa ini Bun meng-inline `process.env.NODE_ENV` jadi `"development"` saat build, sehingga default `production` dan env runtime diabaikan.
- **Modul `server/cli/*` tidak boleh meng-import `server/env.ts`** (langsung atau lewat `logger`, `app-info`, `db`, `engines/deps`, `system-memory`): `env.ts` melempar tanpa `DATABASE_URL`, padahal `init`/`doctor` harus jalan tanpa `.env`. Versi dari `package.json` langsung; DB lewat `postgres(DATABASE_URL)` di `cli/migrate.ts`.
- **Boot guard:** di binary, server exit 1 bila migrasi tertunda atau DB tak terhubung (`bootMigrationError()`). Jangan melemahkannya untuk smoke — smoke memakai DB dev yang sudah termigrasi.
- **doctor tidak pernah `dlopen` file berkarantina** (memicu dialog Gatekeeper): cek `xattr -rl` dulu. Nilai secret hanya dilaporkan terisi/kosong.
