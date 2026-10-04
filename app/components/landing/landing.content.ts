/** Marketing copy for the landing page, kept out of the components so it is easy to edit. */
import type { IconType } from 'react-icons';
import {
  FiActivity,
  FiCheckCircle,
  FiClipboard,
  FiCode,
  FiCpu,
  FiDatabase,
  FiEdit3,
  FiFileText,
  FiGrid,
  FiKey,
  FiLayers,
  FiList,
  FiLogIn,
  FiMic,
  FiMonitor,
  FiPackage,
  FiSettings,
  FiShield,
  FiTag,
  FiTerminal,
  FiTool,
  FiUsers,
  FiZap,
} from 'react-icons/fi';

export const GITHUB_URL = 'https://github.com/bipprojectbali/makuro-template';

export type Feature = { icon: IconType; color: string; title: string; desc: string };

export const FEATURES: Feature[] = [
  {
    icon: FiLayers,
    color: 'blue',
    title: 'Satu port, satu proses',
    desc: 'API Elysia dan SSR React Router berjalan di proses yang sama. Tanpa reverse proxy, tanpa CORS, dev dan prod identik.',
  },
  {
    icon: FiCode,
    color: 'violet',
    title: 'Type-safe ujung ke ujung',
    desc: 'Eden Treaty menarik tipe client langsung dari route Elysia. Tanpa codegen, tanpa drift antara server dan client.',
  },
  {
    icon: FiShield,
    color: 'teal',
    title: 'Auth & role siap pakai',
    desc: 'Better Auth dengan Google OAuth, email + password, multi-akun, dan role user / admin / super-admin yang dijaga di loader.',
  },
  {
    icon: FiZap,
    color: 'yellow',
    title: 'SSR tanpa flash',
    desc: 'Loader berjalan di server dengan sesi penuh. Halaman terproteksi tampil lengkap di respons pertama, tanpa spinner beruntun.',
  },
  {
    icon: FiDatabase,
    color: 'orange',
    title: 'Drizzle + PostgreSQL',
    desc: 'Schema-as-code, migrasi idempoten, dan ERD interaktif di konsol. Schema adalah satu-satunya sumber kebenaran.',
  },
  {
    icon: FiGrid,
    color: 'pink',
    title: 'UI produksi dari hari pertama',
    desc: 'Mantine v9, TanStack Query, notifikasi, konfirmasi destruktif, empty state, dan tampilan mobile untuk setiap halaman.',
  },
  {
    icon: FiPackage,
    color: 'cyan',
    title: 'Deploy satu binary',
    desc: 'Kompilasi ke satu file yang membawa runtime, bundle SSR, dan aset. Salin ke server dan jalankan, tanpa install apa pun.',
  },
  {
    icon: FiCpu,
    color: 'grape',
    title: 'Ramah AI agent',
    desc: 'Server MCP bawaan untuk membaca log, DB, dan kesehatan file, plus penjaga ukuran file agar konteks agent tidak meledak.',
  },
];

export type ConsolePage = { icon: IconType; label: string; desc: string; group: string };

export const CONSOLE_PAGES: ConsolePage[] = [
  {
    icon: FiGrid,
    label: 'Overview',
    desc: 'Angka utama dan peringatan yang butuh perhatian.',
    group: 'Ringkasan',
  },
  {
    icon: FiUsers,
    label: 'Users',
    desc: 'Role, ban dengan alasan dan durasi, impersonasi, aktivitas login.',
    group: 'Kelola',
  },
  {
    icon: FiMonitor,
    label: 'Sessions',
    desc: 'Perangkat yang sedang masuk lintas user, cabut sesi.',
    group: 'Kelola',
  },
  {
    icon: FiEdit3,
    label: 'Posts',
    desc: 'Contoh CRUD konten dengan izin pemilik/admin.',
    group: 'Kelola',
  },
  {
    icon: FiKey,
    label: 'API Keys',
    desc: 'Kunci akses dengan scope, kedaluwarsa, rotasi, dan jejak pemakaian.',
    group: 'Kelola',
  },
  {
    icon: FiDatabase,
    label: 'DB Schema',
    desc: 'ERD interaktif, jumlah baris nyata, status migrasi.',
    group: 'Kelola',
  },
  {
    icon: FiList,
    label: 'Visitor Logs',
    desc: 'Kunjungan dengan negara, kota, browser, perangkat, referer.',
    group: 'Monitoring',
  },
  {
    icon: FiLogIn,
    label: 'Login Logs',
    desc: 'Siapa masuk, lewat metode apa, dari mana.',
    group: 'Monitoring',
  },
  {
    icon: FiShield,
    label: 'Rate Limits',
    desc: 'Request yang ditolak, IP dan endpoint tersering.',
    group: 'Monitoring',
  },
  {
    icon: FiTerminal,
    label: 'Server Logs',
    desc: 'Error dan warning proses tanpa akses shell.',
    group: 'Monitoring',
  },
  {
    icon: FiClipboard,
    label: 'Audit Log',
    desc: 'Jejak setiap aksi admin, read-only.',
    group: 'Monitoring',
  },
  {
    icon: FiFileText,
    label: 'File Health',
    desc: 'Ukuran file vs limit, risiko konteks agent.',
    group: 'Monitoring',
  },
  {
    icon: FiTool,
    label: 'Tools & MCP',
    desc: 'Status proses, katalog tool agent, reset cache.',
    group: 'Tools',
  },
  {
    icon: FiTag,
    label: 'Changelog',
    desc: 'Riwayat perubahan per versi dari CHANGELOG.md, dengan filter dan pencarian.',
    group: 'Tools',
  },
  {
    icon: FiCpu,
    label: 'Engines',
    desc: 'Status model STT dan TTS, latensi, memori, plus warmup dan unload sekali klik.',
    group: 'Tools',
  },
  {
    icon: FiMic,
    label: 'Playground',
    desc: 'Rekam atau unggah audio untuk transkripsi live, ketik teks untuk sintesis suara streaming.',
    group: 'Tools',
  },
  {
    icon: FiSettings,
    label: 'Settings',
    desc: 'Auth, rate limit, retensi, maintenance, flags, branding.',
    group: 'Konfigurasi',
  },
];

export const SECURITY_POINTS = [
  {
    icon: FiShield,
    title: 'Rate limiting per IP',
    desc: 'Jendela geser dengan Retry-After, IP klien dibaca dari proxy atau socket, dikonfigurasi dari UI tanpa restart.',
  },
  {
    icon: FiClipboard,
    title: 'Audit trail',
    desc: 'Ubah role, ban, hapus, impersonasi, ubah settings, purge log — semua tercatat dengan aktor, IP, dan detail.',
  },
  {
    icon: FiActivity,
    title: 'Mode maintenance',
    desc: 'Tutup app sementara dengan 503 untuk semua kecuali role yang diizinkan. Login tetap terbuka agar admin bisa masuk.',
  },
  {
    icon: FiMonitor,
    title: 'Kendali sesi',
    desc: 'Lihat semua perangkat yang masuk, cabut satu sesi atau semua sesi user, tandai sesi impersonasi.',
  },
  {
    icon: FiCheckCircle,
    title: 'Aksi destruktif terjaga',
    desc: 'Konfirmasi yang menjelaskan dampak, super-admin dari env yang tidak bisa dikunci dari UI, pengaman agar tidak mengunci diri.',
  },
  {
    icon: FiCpu,
    title: 'Retensi otomatis',
    desc: 'Log kunjungan, login, rate-limit, dan audit dibersihkan sesuai usia maksimum, dijalankan harian.',
  },
];

export const STACK = [
  { label: 'Bun', color: 'orange' },
  { label: 'Elysia', color: 'violet' },
  { label: 'React 19', color: 'cyan' },
  { label: 'React Router v8 SSR', color: 'blue' },
  { label: 'Drizzle ORM', color: 'green' },
  { label: 'PostgreSQL', color: 'blue' },
  { label: 'Better Auth', color: 'teal' },
  { label: 'Mantine v9', color: 'indigo' },
  { label: 'TanStack Query', color: 'red' },
  { label: 'Zustand', color: 'orange' },
  { label: 'TypeScript', color: 'blue' },
  { label: 'Biome', color: 'green' },
  { label: 'Vite', color: 'violet' },
  { label: 'Pino', color: 'gray' },
  { label: 'MCP', color: 'grape' },
];

export const QUICK_START = `# 1. Install
bun install

# 2. Konfigurasi env (DATABASE_URL, BETTER_AUTH_SECRET)
cp .env.example .env

# 3. Migrasi database
bun run db:migrate

# 4. Jalankan (API + SSR + HMR di satu port)
bun run dev

# 5. Produksi: satu binary, tanpa Bun di server
bun run build:binary:linux && scp st4s-linux-x64 server:/srv/app/`;

export const ARCH = `Browser
  │
  ▼ HTTP :3005
┌──────────────────────────────────────────────┐
│             Bun  (satu proses)               │
│                                              │
│  /api/auth/*   →  Better Auth                │
│  /api/*        →  Elysia  (rate limit, MCP)  │
│  /assets/*     →  static, immutable cache    │
│  /*            →  React Router SSR + loader  │
│                                              │
│  Drizzle ORM ──────────────▶ PostgreSQL      │
└──────────────────────────────────────────────┘`;

export const FAQ = [
  {
    q: 'Apakah ini cocok untuk produksi, bukan sekadar starter?',
    a: 'Ya. Setiap halaman punya loader SSR, empty state, konfirmasi destruktif, notifikasi, tampilan mobile, dan test. Rate limiting, audit trail, retensi log, dan mode maintenance sudah ada dari awal.',
  },
  {
    q: 'Bagaimana cara deploy?',
    a: 'Tiga opsi: `bun run start` di server dengan Bun, Docker (Dockerfile disertakan), atau satu binary hasil `bun run build:binary:linux` yang tidak butuh Bun maupun npm di server. Yang wajib ada hanya PostgreSQL.',
  },
  {
    q: 'Provider login apa yang didukung?',
    a: 'Email + password dan Google OAuth siap pakai. Better Auth mendukung puluhan provider lain; tambahkan di server/auth.ts. Super-admin ditentukan lewat env agar tidak bisa dikunci dari UI.',
  },
  {
    q: 'Bagaimana dengan multi-instance atau horizontal scaling?',
    a: 'Sesi dan settings ada di PostgreSQL, jadi aman lintas instance. Rate limiter dan buffer log server ada di memori per proses; untuk banyak instance, ganti store limiter ke Redis (dokumentasi menunjukkan titik gantinya).',
  },
  {
    q: 'Apa itu server MCP di dalamnya?',
    a: 'Endpoint /api/mcp yang dilindungi token, dipakai agent AI seperti Claude Code untuk membaca log terbaru, statistik DB, sesi aktif, dan memeriksa ukuran file sebelum membacanya, tanpa akses shell ke server.',
  },
  {
    q: 'Lisensinya apa?',
    a: 'MIT. Bebas dipakai untuk produk komersial. Tidak ada dependensi berlisensi copyleft; parser user-agent ditulis sendiri karena alasan itu.',
  },
];
