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

Child engine di binary (re-exec `--st4s-engine-child`, `libonnxruntime` di samping binary): lihat `.claude/rules/engines.md` bagian **Binary**.
