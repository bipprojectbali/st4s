---
paths:
  - "app/routes.ts"
  - "app/routes/**"
  - "app/components/**"
  - "app/lib/**"
  - "server/sidebar-badges.ts"
  - "server/sidebar.ts"
  - "server/landing-stats.ts"
  - "server/readme.ts"
  - "README.md"
  - "tests/readme-endpoint.test.ts"
---

## Konvensi Halaman `/dev` & Error

- **Menambah halaman `/dev` baru = lima tempat:** `app/routes.ts`, `NAV` di `app/routes/super/layout.tsx`, `QuickLinks` overview, `CONSOLE_PAGES` di `app/components/landing/landing.content.ts` + `CONSOLE_PAGE_COUNT` di `server/landing-stats.ts` (test menjaga ketiganya sinkron), dan badge di `server/sidebar-badges.ts` (nada `alert` untuk hal yang butuh tindakan, `info` untuk skala; satu query agregat murah, gagal lunak).
- **Pola halaman konsol:** loader SSR + `toJson` + react-query `initialData`; komponen bersama di `app/components/logs/*` (StatTile, BreakdownPanel, LogCells, DetailParts, TruncatedText); tabel desktop + kartu mobile; drawer detail; aksi lewat hook `use*Actions` dengan `modals.openConfirmModal` dan `notifications`; aksi berhak istimewa dipanggil `audit()` di server dan labelnya ditambahkan ke `ACTION_META` di `app/lib/audit-api.ts`.
- **Tooltip di dalam `Menu.Target` mematikan klik** — jangan bungkus target menu dengan Tooltip.
- **Error boundary:** setiap layout area (`super/admin/user`) merender `AppFrame` lewat helper `Frame` yang dipakai ulang oleh `ErrorBoundary` bersama `AreaErrorBoundary`, sehingga halaman yang gagal tetap punya sidebar. Halaman baru tidak perlu boundary sendiri; jangan hapus `ErrorBoundary` di layout. Kode status/pesan error halaman berasal dari katalog `app/lib/error-page.ts`.
- **README.md dilayani publik** di `/README.md` dan `/llms*.txt` (satu sumber, juga ter-embed ke binary). Jangan tulis rahasia, hostname internal, atau kredensial contoh yang valid di README; test `tests/readme-endpoint.test.ts` memindainya. Fitur baru yang mengubah kontrak publik wajib menambah/menyunting bagian README yang relevan di commit yang sama.
