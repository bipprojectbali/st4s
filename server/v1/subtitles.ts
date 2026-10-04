/** SRT / WebVTT rendering of transcript segments. */
import type { TranscriptSegment } from '../engines/types';

function stamp(sec: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

const cues = (segments: TranscriptSegment[]) => segments.filter((s) => s.text.trim());

/** SubRip: numbered cues, `HH:MM:SS,mmm --> HH:MM:SS,mmm`, blank line between cues. */
export function toSrt(segments: TranscriptSegment[]): string {
  return cues(segments)
    .map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text.trim()}\n`)
    .join('\n');
}

/** WebVTT: `WEBVTT` header, `HH:MM:SS.mmm --> HH:MM:SS.mmm` cues. */
export function toVtt(segments: TranscriptSegment[]): string {
  const body = cues(segments)
    .map((s) => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text.trim()}\n`)
    .join('\n');
  return body ? `WEBVTT\n\n${body}` : 'WEBVTT\n';
}
