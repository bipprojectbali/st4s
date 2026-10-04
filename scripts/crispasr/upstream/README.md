Patches for upstream CrispStrobe/CrispASR, made against upstream main 199de52d9 (2026-10-03). Not sent yet.

- `0001-fix-vad-report-a-failed-Silero-inference-as-3-not-as.patch`: a Silero inference failure returns -3 from `crispasr_vad_slices` instead of 0 ("no speech"). This is the only delta still missing upstream.

The other two s4s patches need no upstream submission: `../crisp-audio-filtered-load.patch` backports upstream e144dd03, and `../crisp-vad-load-error.patch` backports 6b699c8df + 188e21c1a (-3 on a VAD model that cannot load) plus the delta above.
