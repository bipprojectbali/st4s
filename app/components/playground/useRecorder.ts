import { useEffect, useRef, useState } from 'react';

function stopTracks(r: MediaRecorder | null) {
  for (const t of r?.stream.getTracks() ?? []) t.stop();
}

/** Microphone recording via MediaRecorder; `stop()` resolves with the recorded Blob. */
export function useRecorder() {
  const rec = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const release = () => {
    stopTracks(rec.current);
    rec.current = null;
    setRecording(false);
    setStartedAt(null);
  };
  useEffect(() => () => stopTracks(rec.current), []);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Browser ini tidak mendukung perekaman mikrofon. Unggah file audio saja.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const r = new MediaRecorder(stream);
    rec.current = r;
    r.start();
    setRecording(true);
    setStartedAt(Date.now());
  };

  const stop = () =>
    new Promise<Blob>((resolve, reject) => {
      const r = rec.current;
      if (!r) return reject(new Error('Perekaman belum dimulai.'));
      const parts: Blob[] = [];
      r.ondataavailable = (e) => parts.push(e.data);
      r.onstop = () => {
        resolve(new Blob(parts, { type: r.mimeType || 'audio/webm' }));
        release();
      };
      r.stop();
    });

  return { recording, startedAt, start, stop };
}

/** File extension for a recorded Blob's MIME type (the API sniffs content, the name is cosmetic). */
export function extFor(type: string): string {
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('mp4') || type.includes('aac')) return 'm4a';
  if (type.includes('wav')) return 'wav';
  return 'webm';
}
