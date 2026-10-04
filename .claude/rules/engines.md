---
paths:
  - "server/engines/**"
  - "server/v1/**"
  - "server/audio/**"
  - "server/text/**"
  - "server/memory-guard/**"
  - "server/dev.ts"
  - "server/prod.ts"
  - "scripts/crispasr/**"
  - "tests/engines/**"
  - "tests/v1/**"
  - "tests/e2e/**"
  - "tests/audio/**"
  - "app/components/engines/**"
  - "app/components/playground/**"
  - "app/routes/super/engines.tsx"
  - "app/routes/super/playground.tsx"
---

## Konvensi Engine Suara (st4s)

- **Kontrak** `SttEngine`/`TtsEngine` + `EngineBusyError` ada di `server/engines/types.ts`. Route hanya memanggil `getStt()`/`getTts()` dari `server/engines/registry.ts` (slot di `globalThis.__st4sEngines`, agar salinan bundle SSR memakai instance yang sama); slot kosong → `503 engine_unavailable`.
- **Lazy & boot:** engine tidak memuat apa pun sampai request pertama/warmup. `server/dev.ts` dan `server/prod.ts` memanggil `bootEngines()` + `exitOnShutdownSignals()` (SIGINT/SIGTERM → unload, batas 5 dtk). Test **tidak pernah** mem-boot engine asli — pasang fake lewat `setEngines({ stt, tts })` (pola `tests/v1/fake-stt.ts`) dan kosongkan lagi di `afterAll`.
- **Satu child process per engine:** FFI `libcrispasr` sinkron dan ONNX berat, jadi keduanya dijalankan di child agar event loop server tidak beku. Tiap engine memproses satu job sekaligus dengan antrean serial; antrean penuh → `EngineBusyError` → `429 engine_busy` + `Retry-After` (bukan 503).
- **Streaming STT:** Qwen3-ASR tidak punya callback per token, jadi `transcript.text.delta` = satu delta per potongan VAD. `STT_MAX_CHUNK_SEC` 30 vs 8 terukur RTF 0,45 vs 0,31, tetapi kualitas transkrip turun di 8 — default tetap 30; jangan turunkan demi delta lebih sering tanpa mengukur ulang kualitas.
- **Memori (target mesin 8 GB):** child STT (decode CPU) ~1,6 GB footprint setelah model dimuat, puncak ~2,1 GB dengan lib default v0.8.41 (lib lebih lama memuat GGUF kedua kali untuk audio encoder → ~3,45 GB, dan dengan `STT_GPU=1` salinan itu ter-wire ke Metal di luar RSS — biarkan `STT_GPU` mati di host 8 GB). TTS ~460 MB.
- **Probe model asli** (skrip probe, `ST4S_REAL_ENGINE=1 bun test tests/e2e/v1-real.test.ts`): ambil lock global `until mkdir /tmp/s4s-model.lock 2>/dev/null; do sleep 5; done`, pastikan `memory_pressure | tail -1` ≥ 25% free, jalankan di proses sendiri dengan `timeout`, pasang watchdog RAM yang hanya membunuh PID probe itu sendiri (PID ditulis eksplisit; jangan pernah kill proses yang tidak kamu mulai), akhiri skrip dengan `process.exit(0)`, dan selalu `rmdir` lock lewat `trap`. Jangan jalankan model asli bersamaan dengan build.
- **libcrispasr:** dibangun `bash scripts/crispasr/build.sh` ke `.crispasr/` (gitignored; rilis ter-pin + satu patch, detail di README). Default `CRISPASR_LIB` = `<cwd>/.crispasr/build/src/libcrispasr.dylib`; lib hilang/gagal dimuat → engine gagal keras dengan path + perintah build, jangan tambah fallback ke path lain. Jangan salin dylib-nya sendirian — ia menautkan `@rpath/libggml*.dylib` di direktori build. `.crispasr` ada di `IGNORED_DIRS` file-health; walker repo baru wajib mengabaikannya juga.
- **Engine gagal keras, bukan diam:** saat load tiap engine menjalankan self-test di child (STT: klip `selftest.wav`, VAD, hening → `""`; TTS: panjang + RMS); gagal → state `error`, child dihentikan, route menjawab `503 engine_unavailable` (`EngineNotReadyError`; detail hanya di log & `/dev/engines`). `ENGINE_SELFTEST=0` mematikan; spawner yang diinjeksi test otomatis tanpa self-test. VAD yang gagal pada audio → `VadFailedError` di sumber (`spans.ts`) → `500 vad_failed`; melintasi IPC child sebagai field `code`, **jangan** dicocokkan lewat string pesan. Child STT selalu dijalankan dengan `CRISPASR_VAD_FAILOVER=0` (`sttChildEnv` di `host.ts`) — jangan dihapus: failover membuat Qwen3-ASR mengarang teks untuk klip panjang hening.
- **Bentuk `/api/v1` = tipe SDK `openai`:** cek `node_modules/openai/resources/audio/*.d.ts` sebelum mengubah field. Contoh yang sudah dikunci test: `language` di `verbose_json` = nama Inggris huruf kecil (`"indonesian"`), `transcript.text.done` tanpa `usage` (SDK mengetiknya sebagai token), `usage` durasi hanya di `json`/`verbose_json`.
- **Binary:** child dijalankan dengan me-re-exec binary itu sendiri sebagai `--st4s-engine-child stt|tts` (`server/engines/child-argv.ts`); dari source memakai `bun <entry>`. `bun build --compile` tidak meng-embed `libonnxruntime.1.dylib`/`.so.1`, jadi TTS di binary butuh library itu di samping binary + `DYLD_LIBRARY_PATH` (`LD_LIBRARY_PATH` di Linux, belum dites). STT tidak butuh apa-apa tambahan.
- **Route v1 baru** wajib dipetakan scope-nya di `server/api-keys/scopes.ts` (`stt:transcribe`, `tts:speak`, atau publik di `isPublicRead`) + assertion di `tests/api-keys/scopes.test.ts`.
- **Privasi:** log engine dan v1 hanya berisi metrik (durasi, ukuran, RTF, model, status) — **tidak pernah** transkrip, teks input, atau byte audio, termasuk di pesan error dan audit.
