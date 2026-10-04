---
paths:
  - "app/root.tsx"
  - "app/routes.ts"
  - "app/routes/**/*.tsx"
---

# SEO & Meta Tags — Detail Pola

Blocker-nya ada di `CLAUDE.md` (bagian SEO & Meta Tags); file ini berisi format dan konvensinya.

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

