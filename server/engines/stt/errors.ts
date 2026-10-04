/** A job failed because the STT child was unloaded (idle, /dev/engines, shutdown); the API maps it to 503. */
export class SttUnloadedError extends Error {
  constructor() {
    super('STT engine unloaded');
    this.name = 'SttUnloadedError';
  }
}
