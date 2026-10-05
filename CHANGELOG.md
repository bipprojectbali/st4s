# Changelog

Semua perubahan penting di project ini dicatat di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/).

## [0.2.0] - 2026-10-05

### Added
- Perintah binary `st4s init` (menyiapkan folder dan `.env` berizin 0600 dengan secret acak, tanpa pernah menimpa `.env` yang ada), `st4s doctor` (checklist ✅/❌ beserta saran perbaikan untuk `.env`, database, karantina macOS, library, model, ffmpeg, dan RAM), `st4s migrate` (migrasi database sudah ter-embed di binary), dan `st4s --version`. Binary kini membaca `.env` dari folder st4s (bukan dari direktori kerja), berjalan sebagai production bila `NODE_ENV` tidak di-set, dan menolak start dengan pesan "jalankan `st4s migrate`" bila database belum dimigrasi.
- Perintah `st4s models` untuk menyiapkan model suara: `list` menampilkan file yang ada/hilang beserta ukuran dan lisensinya, `pull [stt|tts|all]` mengunduh model dari HuggingFace (versi dipin dan diverifikasi sha256, bisa dilanjutkan bila terputus, cek ruang disk dulu), dan `import <folder>` memasang model dari salinan lokal tanpa internet. Teks lisensi OpenRAIL-M Supertonic ikut ditulis ke `models/tts/LICENSE`; mirror bisa dipakai lewat `ST4S_MODELS_BASE_URL`.
- Paket rilis siap pasang: `sh install.sh [tarball]` memasang atau meng-upgrade st4s ke `~/.st4s` tanpa sudo (binary, library, dan lisensi dalam satu tarball), memverifikasi checksum `.sha256`, menolak tarball untuk OS/CPU lain, menghapus blokir karantina macOS, dan tidak pernah menyentuh `.env`, `models/`, maupun `logs/` yang sudah ada. Tanpa argumen, rilis terbaru diunduh dari GitHub.
- Satu folder untuk semua file st4s lewat `ST4S_HOME` (binary otomatis memakai foldernya sendiri, mis. `~/.st4s`): library, model STT/TTS, dan log diambil dari `lib/`, `models/`, dan `logs/` di dalamnya, tanpa perlu mengisi path satu per satu. Path yang di-set di env tetap diutamakan, dan file yang hilang dilaporkan beserta path lengkapnya serta saran `st4s models pull`/`st4s doctor`.
- Panduan pemakaian Speech API untuk agent di `/skill.md` (auth dan scope, contoh curl/Python/JavaScript dengan SDK `openai`, parameter tiap endpoint, event streaming dan WebSocket, serta tabel kode error), ditautkan pertama di `/llms.txt`.
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
- Panel Realtime di `/dev/playground`: transkripsi langsung dari mikrofon lewat WebSocket `/api/v1/realtime` (kompatibel OpenAI Realtime), dengan deteksi giliran otomatis (VAD) atau manual lewat tombol "Kirim giliran".
- API Realtime kompatibel OpenAI di `wss://<host>/api/v1/realtime` untuk transkripsi langsung: kirim audio PCM 24 kHz potongan kecil dan terima transkrip per giliran. Giliran dideteksi otomatis oleh Silero VAD (`server_vad`) atau di-commit manual, SDK `openai` (`OpenAIRealtimeWS`) bisa dipakai apa adanya, dan jumlah sesi, durasi sesi, idle, serta panjang giliran dibatasi lewat `RT_MAX_SESSIONS`, `RT_MAX_SESSION_SEC`, `RT_IDLE_TIMEOUT_SEC`, dan `RT_MAX_TURN_SEC`.
- Scope API key baru `stt:transcribe` dan `tts:speak`, bisa dipakai di kunci pribadi maupun kunci yang dibuat admin.
- Memory guard untuk host dengan RAM terbatas. Saat RAM bebas di bawah 30%, request audio dan warmup baru ditolak dengan `503 memory_pressure` + `Retry-After` sampai RAM pulih. Di bawah 20%, engine yang idle di-unload lebih dulu, dan di bawah 12% STT lalu TTS di-unload segera. Engine tidak dimuat ulang otomatis. Ambang diatur lewat `MEM_GUARD_*`.
- `/dev/engines` menampilkan peringatan saat RAM menipis atau memory guard baru saja meng-unload engine, dan badge sidebar ikut menyala. Unload otomatis tercatat di Audit Log.
- Memory guard mengecek RAM bebas sebelum memuat engine yang belum termuat (STT butuh 2.600 MB, TTS 600 MB; diatur lewat `MEM_BUDGET_STT_MB`/`MEM_BUDGET_TTS_MB`, `0` = nonaktif). Bila kurang, request atau warmup ditolak `503 memory_pressure` dengan pesan RAM yang dibutuhkan vs tersedia, dan `/dev/engines` menampilkan penolakan terakhir. Unload otomatis kini tercatat sebagai aksi sendiri "Unload otomatis engine" di Audit Log.
- Engine STT dan TTS menguji dirinya sendiri setiap kali dimuat (transkripsi klip contoh, VAD, hening; sintesis frasa uji). Engine yang hasilnya salah tidak lagi dianggap siap: statusnya `error` dengan alasan dan langkah perbaikan di `/dev/engines`, request mendapat `503 engine_unavailable`, dan tombol warmup berubah menjadi "Coba muat ulang". Bisa dimatikan dengan `ENGINE_SELFTEST=0`.

### Changed
- STT kini memakai libcrispasr ber-patch secara default (`.crispasr/build/src/libcrispasr.dylib`, dibangun lewat `scripts/crispasr/build.sh`), sehingga puncak RAM STT turun dari ~3,5 GB ke ~2,1 GB dengan transkrip yang sama. Lib tanpa patch masih bisa dipakai lewat `CRISPASR_LIB`.
- libcrispasr kini dibangun di dalam project (`.crispasr/`, tidak ikut git) oleh `bash scripts/crispasr/build.sh`, dan server memuatnya tanpa perlu `CRISPASR_LIB` di `.env` — tidak ada lagi lib lama di `~/tmp` yang terpakai diam-diam. Bila lib tidak ditemukan atau gagal dimuat, engine STT gagal dengan pesan yang menyebut path-nya dan perintah build yang harus dijalankan.
- libcrispasr kini dibangun tanpa dekoder AMR/Opus (st4s sudah men-decode audio lewat ffmpeg), sehingga tidak lagi bergantung pada library Homebrew. `bash scripts/crispasr/bundle-lib.sh <folder>` menyalin libcrispasr beserta library ggml ke satu folder yang bisa dipindah ke mesin lain dan memverifikasi folder itu bisa dimuat. Jalankan ulang `bash scripts/crispasr/build.sh` agar lib lama ikut diperbarui.
- Error di bawah `/api/v1` kini berbentuk error OpenAI (`{ error: { message, type, param, code } }`) agar SDK `openai` bisa membacanya. Route `/api/*` lain tetap memakai format lama.
- Pesan error `/api/v1` kini berbahasa Indonesia (nilai `code`, `type`, dan status HTTP tidak berubah), dan `V1_FFMPEG_PATH` digabung ke `FFMPEG_PATH` — satu variabel kini dipakai untuk decode upload maupun encode audio.
- Saat antrean engine penuh, API menjawab `429 engine_busy` dengan header `Retry-After` agar klien tahu kapan mencoba lagi.
- Transkripsi menolak request lebih awal saat antrean STT penuh (sebelum upload dibaca), dan decode audio dibatasi `V1_DECODE_CONCURRENCY` (default 2) agar lonjakan upload tidak menghabiskan memori.
- `prompt` + `keywords` transkripsi dibatasi 50 istilah dan 1000 karakter; lebih dari itu dijawab `400` dengan `param: 'keywords'`.
- README menjelaskan bahwa bahasa default transkripsi adalah `id` (berbeda dari deteksi otomatis OpenAI) dan memberi rekomendasi limit untuk host 8 GB.
- STT kini decode di CPU secara default; set `STT_GPU=1` untuk Metal (fallback otomatis ke CPU). Di Mac 8 GB GPU membuat RAM bebas anjlok karena salinan model kedua ter-wire.
- Pembacaan RAM bebas kini lebih akurat dan murah. Di Linux angka diambil dari `MemAvailable` di `/proc/meminfo` (sebelumnya `os.freemem`), dan di macOS dibaca langsung dari kernel tanpa menjalankan `sysctl` tiap kali.
- Server dev, production, dan binary kini menyiapkan engine suara saat boot dan mematikannya dengan rapi saat dihentikan (Ctrl+C atau SIGTERM).
- Binary bisa menjalankan engine suara tanpa Bun terpasang. Untuk text-to-speech, letakkan library onnxruntime di samping binary (lihat README).
- Tombol "Lanjutkan dengan Google" kini menjadi tombol utama di halaman login saat Google dikonfigurasi; login email tampil sebagai pilihan kedua. Halaman login juga punya deskripsi untuk mesin pencari.
- README dan `.env.example` menjelaskan cara menyiapkan login Google: redirect URI yang perlu didaftarkan (`${BETTER_AUTH_URL}/api/auth/callback/google`), env yang dibutuhkan, dan aturan pendaftaran tertutup.
- Setiap request yang ditolak karena API key (kunci tidak dikenal, kedaluwarsa, nonaktif, dicabut, scope atau IP tidak diizinkan) kini tercatat sebagai satu baris peringatan `api key refused` di Server Logs berisi kode, status, path, dan ID kunci bila sudah dikenali, tanpa isi kunci. Klien yang salah konfigurasi atau penyalahgunaan kini terlihat.
- Aplikasi berganti nama dari Makuro menjadi **st4s** (speech-to-text & text-to-speech server kompatibel OpenAI): judul halaman, landing, nama default di Settings, nama binary (`./st4s`, `st4s-linux-x64`, `st4s-linux-musl`), dan nama server MCP (`st4s-debug`). Variabel env ikut berganti: `S4S_REAL_ENGINE` → `ST4S_REAL_ENGINE` dan `MAKURO_MCP_KEY` → `ST4S_MCP_KEY` — perbarui `.mcp.json` dan env shell kamu. API key `mk_live_…`, database, dan nama aplikasi yang sudah disimpan di Settings tidak berubah.

### Fixed
- Model yang tidak dikenal kini dijawab sama di semua endpoint `/api/v1`, seperti api.openai.com: `404 model_not_found` (`type: invalid_request_error`, `param: model`) di `/audio/speech` dan `/audio/transcriptions` (sebelumnya 400) maupun `GET /models/:id`. SDK `openai` kini melempar `NotFoundError`, bukan `BadRequestError` — sesuaikan `catch` bila kamu menangkapnya. Model yang ada tapi salah jenis (model TTS untuk transkripsi atau sebaliknya, termasuk di realtime) kini `400 invalid_value`, dan `model` kosong di `/audio/speech` menjadi `400 missing_required_parameter`.
- API key yang ditolak kini selalu menjawab kode error yang stabil dan sesuai OpenAI, bukan kode internal library: key tidak dikenal, kedaluwarsa, nonaktif, atau dicabut → `401 invalid_api_key` (pesan menyebut penyebabnya), kuota habis → `429 insufficient_quota` (sebelumnya keliru 401), dan rate limit per key → `429 rate_limit_exceeded` dengan header `Retry-After`. Di luar `/api/v1` kodenya sama dalam huruf besar (`INVALID_API_KEY`, `INSUFFICIENT_QUOTA`, `RATE_LIMIT_EXCEEDED`).
- Model VAD (`STT_VAD_MODEL`) yang korup atau gagal dijalankan tidak lagi menghasilkan transkrip kosong secara diam-diam: dengan libcrispasr ber-patch terbaru (`scripts/crispasr/build.sh`, kini di-pin ke rilis upstream v0.8.41 plus satu patch, sehingga bisa dibangun ulang di mesin baru), transkripsi gagal dengan 500 `vad_failed` (detail di log) alih-alih mengarang teks dari audio hening, dan realtime mengirim error `vad_failed` (baik di `server_vad` maupun pada giliran yang gagal).
- Audio panjang (≥2 menit) yang hening atau hampir tanpa ucapan kini menghasilkan transkrip kosong dengan libcrispasr v0.8.41, bukan teks karangan: *VAD failover* bawaan rilis itu selalu dimatikan untuk proses STT.
- Request transkripsi/suara yang sedang diproses atau mengantre saat engine dilepas (RAM menipis, idle, shutdown, atau unload manual di `/dev`) kini langsung ditolak dengan 503 `engine_unloaded` + `Retry-After: 5` (di luar `/api/v1`: `ENGINE_UNLOADED`), bukan diam-diam memuat ulang model dan memakan RAM lagi. Request baru setelahnya tetap memuat engine seperti biasa.
- Saat pendaftaran ditutup (`AUTH_DISABLE_SIGNUP` atau toggle "Pendaftaran" di `/dev/settings`), login Google tidak lagi diam-diam membuat akun baru. Orang yang belum punya akun dikembalikan ke halaman login dengan pesan "Pendaftaran akun baru sedang ditutup"; user lama tetap bisa masuk, dan email di `SUPER_ADMIN_EMAILS` tetap boleh membuat akun.
- Login Google untuk email yang sudah terdaftar dengan kata sandi tapi belum terverifikasi kini menampilkan petunjuk masuk dengan kata sandi, bukan kode error mentah.
- Halaman login menampilkan pesan bahasa Indonesia saat aplikasi dibuka dari alamat yang tidak dikenali (sebelumnya "Invalid origin"), dan tombol Google tidak lagi berputar terus bila permintaan ditolak. Kolom email dan kata sandi kini 16px sehingga iPhone tidak lagi memperbesar layar saat diketuk.
- Transkripsi tanpa model VAD kini memotong audio per `STT_MAX_CHUNK_SEC` alih-alih mendecode seluruh file sekaligus.
- Klien yang memutus koneksi saat transkripsi berjalan kini menghentikan job di batas potongan berikutnya, sehingga request berikutnya di antrean tidak ikut menunggu.
- Job transkripsi yang terhenti karena engine di-unload kini dijawab `503 engine_unavailable` + `Retry-After` (bukan 500), dan unload yang dipanggil bersamaan tidak lagi menggantung.
- Event error di tengah stream transkripsi kini membawa `type: 'error'` seperti event SSE lainnya.
- Respons transkripsi kini sesuai bentuk SDK OpenAI: `language` di `verbose_json` berupa nama bahasa seperti whisper-1 (`"indonesian"`, bukan `"id"`), dan event `transcript.text.done` tidak lagi membawa `usage` berbentuk durasi yang tidak dikenal SDK di event itu (`json`/`verbose_json` tetap membawa `usage` durasi).
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
- `/dev/engines` kini selalu menampilkan ringkasan memory guard (level, sisa RAM, ambang menipis/kritis/darurat, budget STT/TTS). Judul peringatan mengikuti keadaan sebenarnya ("Request audio ditolak sampai RAM pulih", "STT di-unload otomatis", penolakan budget) dan tidak lagi berbunyi "RAM normal" dengan warna peringatan.
- Waktu "Dimuat" di kartu engine tidak lagi terpotong di desktop; kolom input dan slider di `/dev/playground` memakai lebar penuh di layar ponsel; label kartu statistik (mis. `/dev/audit`) tidak lagi terpotong di layar 375 px.
- Log memory guard di konsol dev tidak lagi tampil sebagai `USERLVL`, dan levelnya terbaca benar di Server Logs dan log JSON production.
- Tombol "Hentikan" di panel Realtime `/dev/playground` kini bisa ditekan selama "Menghubungkan…" dan langsung membatalkan sesi (mikrofon dan koneksi dilepas), jadi sesi yang macet tidak lagi memaksa muat ulang halaman. Bila browser tidak bisa menyiapkan perekam audio atau server tidak merespons dalam 10 detik, panel menampilkan pesan error yang jelas alih-alih menunggu terus.
- Audio hening atau tanpa ucapan kini menghasilkan transkrip kosong (`""`), bukan teks karangan seperti "okay.", baik di `/api/v1/audio/transcriptions` maupun giliran Realtime (event `completed` dengan `transcript: ""`, tanpa `delta` kosong). Bila model VAD tidak ada atau gagal dijalankan, transkripsi tetap berjalan seperti sebelumnya dan alasannya dicatat di log.
- Realtime kini melaporkan engine STT yang gagal dimuat atau gagal self-test sebagai `engine_unavailable` dengan pesan umum, sama seperti API HTTP. Sebelumnya laporannya `server_error`. Bila ini terjadi saat `server_vad`, sesi tetap terbuka dan beralih ke commit manual. Detail teknis kegagalan tidak dikirim ke klien.
- Warmup di `/dev/engines` yang gagal karena self-test kini menampilkan alasan lengkapnya (cek yang gagal dan langkah perbaikan), bukan pesan umum "gagal dimuat".
- Self-test engine yang macet (child hang, host kehabisan RAM) tidak lagi membuat engine tertahan di status `loading` selamanya. Setelah 60 detik (STT) atau 30 detik (TTS), child dihentikan dan statusnya `error` dengan alasan "Self-test … tidak selesai dalam N dtk". Batas waktu bisa dinaikkan untuk host lambat lewat `ENGINE_SELFTEST_TIMEOUT_SEC`.
- Penolakan API key kini membawa `requestId` yang sama dengan baris log `api key refused`, lewat header `x-request-id` dan field `requestId` di body (di luar `/api/v1`), sehingga laporan klien bisa dicocokkan dengan Server Logs. Penolakan "endpoint tidak bisa diakses dengan API key" kini juga menyertakan `code: 'ENDPOINT_NOT_ALLOWED'` di body.

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
