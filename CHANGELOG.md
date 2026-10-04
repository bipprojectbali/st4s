# Changelog

Semua perubahan penting di project ini dicatat di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/).

## [Unreleased]

### Added
- Server memeriksa library, model STT/TTS, dan ffmpeg saat boot. Yang tidak ditemukan dicatat di log (error di production) dan dilaporkan di field `deps` pada `GET /api/engines`, sehingga salah konfigurasi ketahuan sebelum request pertama gagal.
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
- Transkripsi menolak request lebih awal saat antrean STT penuh (sebelum upload dibaca), dan decode audio dibatasi `V1_DECODE_CONCURRENCY` (default 2) agar lonjakan upload tidak menghabiskan memori.
- `prompt` + `keywords` transkripsi dibatasi 50 istilah dan 1000 karakter; lebih dari itu dijawab `400` dengan `param: 'keywords'`.
- README menjelaskan bahwa bahasa default transkripsi adalah `id` (berbeda dari deteksi otomatis OpenAI) dan memberi rekomendasi limit untuk host 8 GB.
- Server dev, production, dan binary kini menyiapkan engine suara saat boot dan mematikannya dengan rapi saat dihentikan (Ctrl+C atau SIGTERM).
- Binary bisa menjalankan engine suara tanpa Bun terpasang. Untuk text-to-speech, letakkan library onnxruntime di samping binary (lihat README).
- Tombol "Lanjutkan dengan Google" kini menjadi tombol utama di halaman login saat Google dikonfigurasi; login email tampil sebagai pilihan kedua. Halaman login juga punya deskripsi untuk mesin pencari.
- README dan `.env.example` menjelaskan cara menyiapkan login Google: redirect URI yang perlu didaftarkan (`${BETTER_AUTH_URL}/api/auth/callback/google`), env yang dibutuhkan, dan aturan pendaftaran tertutup.

### Fixed
- Saat pendaftaran ditutup (`AUTH_DISABLE_SIGNUP` atau toggle "Pendaftaran" di `/dev/settings`), login Google tidak lagi diam-diam membuat akun baru. Orang yang belum punya akun dikembalikan ke halaman login dengan pesan "Pendaftaran akun baru sedang ditutup"; user lama tetap bisa masuk, dan email di `SUPER_ADMIN_EMAILS` tetap boleh membuat akun.
- Login Google untuk email yang sudah terdaftar dengan kata sandi tapi belum terverifikasi kini menampilkan petunjuk masuk dengan kata sandi, bukan kode error mentah.
- Halaman login menampilkan pesan bahasa Indonesia saat aplikasi dibuka dari alamat yang tidak dikenali (sebelumnya "Invalid origin"), dan tombol Google tidak lagi berputar terus bila permintaan ditolak. Kolom email dan kata sandi kini 16px sehingga iPhone tidak lagi memperbesar layar saat diketuk.
- Transkripsi tanpa model VAD kini memotong audio per `STT_MAX_CHUNK_SEC` alih-alih mendecode seluruh file sekaligus.
- Klien yang memutus koneksi saat transkripsi berjalan kini menghentikan job di batas potongan berikutnya, sehingga request berikutnya di antrean tidak ikut menunggu.
- Job transkripsi yang terhenti karena engine di-unload kini dijawab `503 engine_unavailable` + `Retry-After` (bukan 500), dan unload yang dipanggil bersamaan tidak lagi menggantung.
- Event error di tengah stream transkripsi kini membawa `type: 'error'` seperti event SSE lainnya.
- Respons text-to-speech panjang dalam format `mp3`/`opus`/`aac`/`flac` tidak lagi terpotong di tengah saat antrean engine ramai. `TTS_FFMPEG_TIMEOUT_MS` kini batas idle (tanpa audio baru), bukan batas total durasi stream.
- `/api/v1/audio/speech` menjawab `503 engine_unavailable` (bukan 500) bila direktori model TTS tidak ditemukan.
- Beberapa project turunan template kini bisa menjalankan `bun run dev` bersamaan di port berbeda. HMR memakai port aplikasi itu sendiri, bukan port 24678 bersama, sehingga error `WebSocket server error: Port ... is already in use` hilang dan browser tidak lagi menerima hot reload dari project lain.
- Server Logs tidak lagi menggeser posisi scroll setiap beberapa detik. Log baru kini datang langsung dari server (live, tanpa refresh berkala), dan saat kamu sedang membaca di bawah, daftar ditahan dengan tombol "N log baru" untuk kembali ke atas.
- Layar konsol tidak lagi berkedip dan scroll sidebar tidak lagi melompat ke atas sesaat setelah halaman terbuka. Cache data kini terpisah per request dan per tab, sehingga data seorang user juga tidak bisa ikut terbawa ke render user lain di server.
- Waktu (misalnya "5 menit yang lalu" dan tanggal lengkap) ditampilkan dalam zona waktu browser kamu, sama persis antara render server dan browser, tanpa kedipan.
- Kolom "login terakhir" di `/dev/users` tidak lagi meleset beberapa jam ketika zona waktu server berbeda dengan zona waktu browser.
- `/dev/changelog` tidak lagi error saat dibuka di browser.
- Console browser tidak lagi menampilkan error hydration ketika ekstensi browser (VPN/keamanan) menandai elemen halaman dengan atribut `bis_*`/`__processed_*__`.
- Visitor Logs tidak lagi salah menandai bot monitor (UptimeRobot, Pingdom) dan bot lain berawalan `Mozilla/5.0` sebagai `seo-crawler`. Kunjungan lama yang sudah tercatat tidak berubah.
- Transkripsi panjang, request yang menunggu di antrean engine, stream SSE, dan warmup model di production tidak lagi terputus ("socket closed") setelah 60 detik tanpa data. Batas idle 60 detik tetap berlaku untuk route lain.

### Security
- Body request di production dibatasi `V1_MAX_UPLOAD_MB` + 1 MiB (default 26 MiB) dan ditolak 413 sebelum dibaca, sehingga upload raksasa tidak lagi menghabiskan memori server sebelum autentikasi.
- Rate limit dan IP di log tidak bisa lagi dikelabui dengan header `X-Forwarded-For` palsu. Header proxy hanya dipercaya bila koneksi datang dari proxy di `TRUSTED_PROXIES` (default kosong = pakai IP socket). Bila app berjalan di belakang nginx/caddy, set `TRUSTED_PROXIES=loopback` (atau IP proxy) agar IP klien asli tetap terbaca.
- Batas percobaan login bawaan Better Auth dan IP yang tercatat di sesi kini memakai IP klien yang sama dengan aturan `TRUSTED_PROXIES`, sehingga `X-Forwarded-For` palsu tidak bisa lagi dipakai untuk menghindari batas login atau memalsukan IP sesi.
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
