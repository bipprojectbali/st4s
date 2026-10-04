// test-only: stands in for the STT child and reports the env it was started with.
process.send?.({
  failover: process.env.CRISPASR_VAD_FAILOVER ?? null,
  path: process.env.PATH ?? null,
});
process.exit(0);
