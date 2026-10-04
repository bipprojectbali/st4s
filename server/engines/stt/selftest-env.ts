/** Self-test default: on unless ENGINE_SELFTEST=0; off for injected spawners (test fakes that never answer the probe). */
export const selfTestEnabled = (injectedSpawner: boolean, env: NodeJS.ProcessEnv = process.env) =>
  !injectedSpawner && env.ENGINE_SELFTEST !== '0';

/** Self-test deadline in seconds: ENGINE_SELFTEST_TIMEOUT_SEC (positive, applies to STT and TTS) or the engine's default. */
export function selfTestTimeoutSec(defaultSec: number, env: NodeJS.ProcessEnv = process.env) {
  const v = Number(env.ENGINE_SELFTEST_TIMEOUT_SEC);
  return Number.isFinite(v) && v > 0 ? v : defaultSec;
}

/** Indonesian reason for a self-test that never answered; the engine then refuses as for any failed check. */
export const selfTestTimeoutReason = (kind: 'STT' | 'TTS', sec: number) =>
  `Self-test ${kind} tidak selesai dalam ${sec} dtk — child engine macet atau host terlalu lambat/kehabisan RAM. Periksa log server dan RAM bebas, naikkan ENGINE_SELFTEST_TIMEOUT_SEC bila host memang lambat, lalu muat ulang engine di /dev/engines.`;
