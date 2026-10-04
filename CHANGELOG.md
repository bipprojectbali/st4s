# Changelog

Semua perubahan penting di project ini dicatat di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/).

## [Unreleased]

### Added
- Halaman `/dev/changelog` untuk membaca riwayat perubahan langsung dari konsol, lengkap dengan filter jenis perubahan, pencarian, dan peringatan bila versi yang berjalan belum tercatat.
- Dev server menjalankan migrasi database otomatis saat boot, sehingga database lokal yang baru atau tertinggal tidak lagi memicu error `relation does not exist`.
- Tautan landing page kini tampil sebagai kartu bergambar saat dibagikan (WhatsApp, X, Slack, dll) lewat meta Open Graph/Twitter, gambar `/og.png`, dan URL `canonical`.
- `/robots.txt` dan `/sitemap.xml` untuk mesin pencari, dibangun dari `APP_URL`; halaman login, konsol, dan API tidak diindeks.
- Ikon home-screen iOS (`/apple-touch-icon.png`), web manifest, dan warna tema browser.
- API speech-to-text kompatibel OpenAI di `/api/v1/audio/transcriptions`: cukup arahkan SDK `openai` ke `<host>/api/v1`. Mendukung format `json`, `text`, `srt`, `vtt`, `verbose_json`, streaming teks lewat `stream=true`, serta `keywords` untuk membantu mengenali istilah khusus.
- API text-to-speech kompatibel OpenAI di `/api/v1/audio/speech` dengan 10 suara (nama suara OpenAI seperti `alloy` atau `nova` ikut diterima), format `mp3`/`opus`/`aac`/`flac`/`wav`/`pcm`, audio yang langsung mengalir sebelum seluruh teks selesai, serta pilihan `language` dan `steps`.
- Daftar model dan suara di `/api/v1/models` dan `/api/v1/audio/voices`; alias model OpenAI (`whisper-1`, `tts-1`, `gpt-4o-mini-tts`, dll) diterima apa adanya.
- Engine suara lokal: Qwen3-ASR untuk transkripsi dan Supertonic 3 untuk sintesis. Masing-masing berjalan di proses terpisah, dimuat saat pertama dipakai, dan dilepas otomatis setelah idle.
- Halaman `/dev/engines` untuk memantau status, memori, dan latensi engine, lengkap dengan tombol warmup dan unload.
- Halaman `/dev/playground` untuk mencoba transkripsi dan sintesis suara langsung dari konsol.
- Scope API key baru `stt:transcribe` dan `tts:speak`, bisa dipakai di kunci pribadi maupun kunci yang dibuat admin.

### Changed
- Error di bawah `/api/v1` kini berbentuk error OpenAI (`{ error: { message, type, param, code } }`) agar SDK `openai` bisa membacanya. Route `/api/*` lain tetap memakai format lama.
- Pesan error `/api/v1` kini berbahasa Indonesia (nilai `code`, `type`, dan status HTTP tidak berubah), dan `V1_FFMPEG_PATH` digabung ke `FFMPEG_PATH` — satu variabel kini dipakai untuk decode upload maupun encode audio.
- Saat antrean engine penuh, API menjawab `429 engine_busy` dengan header `Retry-After` agar klien tahu kapan mencoba lagi.
- Server dev, production, dan binary kini menyiapkan engine suara saat boot dan mematikannya dengan rapi saat dihentikan (Ctrl+C atau SIGTERM).
- Binary bisa menjalankan engine suara tanpa Bun terpasang. Untuk text-to-speech, letakkan library onnxruntime di samping binary (lihat README).

### Fixed
- Beberapa project turunan template kini bisa menjalankan `bun run dev` bersamaan di port berbeda. HMR memakai port aplikasi itu sendiri, bukan port 24678 bersama, sehingga error `WebSocket server error: Port ... is already in use` hilang dan browser tidak lagi menerima hot reload dari project lain.
- Server Logs tidak lagi menggeser posisi scroll setiap beberapa detik. Log baru kini datang langsung dari server (live, tanpa refresh berkala), dan saat kamu sedang membaca di bawah, daftar ditahan dengan tombol "N log baru" untuk kembali ke atas.
- Layar konsol tidak lagi berkedip dan scroll sidebar tidak lagi melompat ke atas sesaat setelah halaman terbuka. Cache data kini terpisah per request dan per tab, sehingga data seorang user juga tidak bisa ikut terbawa ke render user lain di server.
- Waktu (misalnya "5 menit yang lalu" dan tanggal lengkap) ditampilkan dalam zona waktu browser kamu, sama persis antara render server dan browser, tanpa kedipan.
- Kolom "login terakhir" di `/dev/users` tidak lagi meleset beberapa jam ketika zona waktu server berbeda dengan zona waktu browser.
- `/dev/changelog` tidak lagi error saat dibuka di browser.
- Console browser tidak lagi menampilkan error hydration ketika ekstensi browser (VPN/keamanan) menandai elemen halaman dengan atribut `bis_*`/`__processed_*__`.
- Visitor Logs tidak lagi salah menandai bot monitor (UptimeRobot, Pingdom) dan bot lain berawalan `Mozilla/5.0` sebagai `seo-crawler`. Kunjungan lama yang sudah tercatat tidak berubah.

### Security
- Role super-admin dari `SUPER_ADMIN_EMAILS` kini hanya diberikan ke email yang sudah terverifikasi. Karena belum ada pengiriman email verifikasi, super-admin di produksi masuk lewat Google, atau operator menjalankan `bun run admin:verify <email>` (hanya untuk email di `SUPER_ADMIN_EMAILS`, output email ter-mask).
- Pendaftaran akun email+password kini tertutup di produksi (termasuk binary). Buka lagi dengan `AUTH_DISABLE_SIGNUP=false`; nilai kosong dianggap belum di-set. Login user lama dan Google tetap berjalan.
- Toggle "Login email" dan "Pendaftaran" di pengaturan kini benar-benar ditegakkan server: login/daftar email yang dinonaktifkan ditolak dengan pesan yang jelas, bukan hanya disembunyikan di halaman login. Tanpa Google, login email selalu tetap aktif agar kamu tidak terkunci.

## [0.1.0] - 2026-09-14

### Added
- Konsol admin `/dev` berbasis role dengan sidebar, overview, dan penghitung di setiap menu.
- Kelola user (role, ban dengan alasan dan durasi, impersonasi), sesi aktif lintas perangkat, dan contoh CRUD posts.
- API key dengan scope, kedaluwarsa, rotasi, jejak pemakaian, key pribadi, dan autentikasi MCP.
- Visitor logs, login logs, rate limit logs, server logs, dan audit log untuk setiap aksi admin.
- File Health untuk memantau ukuran file terhadap limit dan risiko konteks agent.
- DB Schema: ERD interaktif, jumlah baris nyata, dan status migrasi.
- Settings: autentikasi, rate limit, retensi log, maintenance, feature flags, dan branding.
- Server MCP bawaan dan halaman Tools untuk agent.
- Landing page publik.
- Halaman error yang seragam dan format error API `{ error, code, status, requestId }`.
- `/README.md`, `/llms.txt`, dan `/api/version` untuk agent.
- Tampilan yang jelas untuk user yang diblokir atau sesinya berakhir.

### Fixed
- `bun run start` dan binary kini boot dengan benar, dan typecheck bersih tanpa error.
- Probe browser seperti `/favicon.ico` tidak lagi jatuh ke SSR dan menghasilkan 404 bertumpuk.
