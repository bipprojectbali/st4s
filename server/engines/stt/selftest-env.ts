/** Self-test default: on unless ENGINE_SELFTEST=0; off for injected spawners (test fakes that never answer the probe). */
export const selfTestEnabled = (injectedSpawner: boolean, env: NodeJS.ProcessEnv = process.env) =>
  !injectedSpawner && env.ENGINE_SELFTEST !== '0';
