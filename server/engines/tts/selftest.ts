/** TTS load-time self-test: synthesize a fixed phrase in the loaded child and reject empty, NaN, silent or absurd-length audio. */
import { logger } from '../../logger';
import { selfTestTimeoutReason, selfTestTimeoutSec } from '../stt/selftest-env';
import type { ChildMsg, ParentMsg } from './protocol';

/** Fixed phrase (never logged); Indonesian, the service's default language. */
export const TTS_SELFTEST_TEXT = 'Halo, ini uji suara.';
const LANGUAGE = 'id';
/** Plausible length for the phrase at speed 1 (measured 2.08 s, RMS 0.05 on Supertonic 3, voice F1); outside = broken model. */
export const TTS_SELFTEST_SEC = { min: 0.4, max: 8 };
/** RMS floor: speech sits ~0.05–0.2; digital silence or a dead decoder is ~0. */
export const TTS_SELFTEST_MIN_RMS = 0.005;
/** Whole self-test deadline: measured ~0.5 s; 60× headroom for a cold, swapping host. */
export const TTS_SELFTEST_TIMEOUT_SEC = 30;
const PROBE_ID = -1;
const RELOAD = 'lalu muat ulang engine di /dev/engines';

/** Null when `pcm` looks like real speech for the phrase, else an Indonesian reason. */
export function checkTtsAudio(
  pcm: Float32Array,
  sampleRate: number,
): { reason: string | null; sec: number; rms: number } {
  const sec = pcm.length / sampleRate;
  let sum = 0;
  for (const x of pcm) sum += x * x;
  const rms = pcm.length ? Math.sqrt(sum / pcm.length) : 0;
  const why = !pcm.length
    ? 'audio hasil sintesis kosong'
    : !Number.isFinite(rms)
      ? 'audio hasil sintesis berisi nilai NaN/Infinity'
      : sec < TTS_SELFTEST_SEC.min || sec > TTS_SELFTEST_SEC.max
        ? `durasi audio ${sec.toFixed(2)} dtk di luar batas wajar ${TTS_SELFTEST_SEC.min}–${TTS_SELFTEST_SEC.max} dtk`
        : rms < TTS_SELFTEST_MIN_RMS
          ? `audio hasil sintesis hening (RMS ${rms.toExponential(1)})`
          : null;
  return {
    reason:
      why &&
      `Self-test TTS gagal: ${why} — periksa file model TTS (TTS_MODEL_DIR) dan onnxruntime, ${RELOAD}.`,
    sec,
    rms,
  };
}

/** Sends the probe synth; `done(reason)` fires once with null on pass. `take(msg)` consumes the probe's reply. */
export function startTtsSelfTest(
  send: (m: ParentMsg) => void,
  args: { voice: string | undefined; steps: number; sampleRate: number },
  done: (reason: string | null) => void,
): { take(msg: ChildMsg): boolean } {
  const t0 = performance.now();
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (reason: string | null, facts: object) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    logger.info(
      { check: 'tts_synth', ms: Math.round(performance.now() - t0), pass: !reason, ...facts },
      'tts self-test check',
    );
    done(reason);
  };
  if (!args.voice) {
    queueMicrotask(() =>
      finish(
        `Self-test TTS gagal: tidak ada voice style di model — periksa TTS_MODEL_DIR, ${RELOAD}.`,
        {},
      ),
    );
    return { take: () => false };
  }
  send({
    type: 'synth',
    id: PROBE_ID,
    text: TTS_SELFTEST_TEXT,
    voice: args.voice,
    language: LANGUAGE,
    speed: 1,
    steps: args.steps,
  });
  const sec = selfTestTimeoutSec(TTS_SELFTEST_TIMEOUT_SEC);
  // A hung child never replies; the engine refuses on this reason and kills it.
  timer = setTimeout(
    () => finish(selfTestTimeoutReason('TTS', sec), { timeout: true }),
    sec * 1000,
  );
  timer.unref?.();
  return {
    take(msg) {
      if (msg.type === 'loaded' || msg.id !== PROBE_ID) return false;
      if (settled) return true;
      if (msg.type === 'error') {
        finish(`Self-test TTS gagal: sintesis frasa uji error — lihat log server, ${RELOAD}.`, {
          err: msg.message,
        });
        return true;
      }
      const r = checkTtsAudio(msg.pcm, args.sampleRate);
      finish(r.reason, { sec: Number(r.sec.toFixed(2)), rms: Number(r.rms.toFixed(4)) });
      return true;
    },
  };
}
