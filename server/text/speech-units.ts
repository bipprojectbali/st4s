/**
 * TTS input splitting, ported from stt/app/lib/sentence-chunk.ts. A sentence is
 * "complete" when a terminator (. ! ? …) is followed by whitespace, so "3.14"
 * is not split. Units never cross a paragraph break, never exceed `maxChars`,
 * and the first unit is only the first sentence so time-to-first-audio is low.
 */

// Terminator + optional closing brackets/quotes, then whitespace.
const SENTENCE = /^([\s\S]*?[.!?…]+[)\]}"'”’»]*)\s+/;

/** Default upper bound for one synthesis unit (characters). */
export const MAX_UNIT_CHARS = 400;
/** Default upper bound for the first unit, which gates time-to-first-audio. */
export const FIRST_UNIT_CHARS = 200;

/** Pull complete sentences out of `buffer`; a terminator-less tail past `maxLen` is force-flushed at a word boundary. */
export function takeSentences(
  buffer: string,
  opts: { maxLen?: number } = {},
): { ready: string[]; rest: string } {
  const maxLen = opts.maxLen ?? 240;
  const ready: string[] = [];
  let rest = buffer;
  while (rest.length > 0) {
    const m = rest.match(SENTENCE);
    if (m) {
      const s = m[1].trim();
      if (s) ready.push(s);
      rest = rest.slice(m[0].length);
      continue;
    }
    if (rest.length > maxLen) {
      const space = rest.lastIndexOf(' ', maxLen);
      const at = space > 40 ? space : maxLen;
      const s = rest.slice(0, at).trim();
      if (s) ready.push(s);
      rest = rest.slice(at).replace(/^\s+/, '');
      continue;
    }
    break;
  }
  return { ready, rest };
}

/** Split `s` at word boundaries into pieces of at most `maxLen` characters. */
export function splitLong(s: string, maxLen: number): string[] {
  const out: string[] = [];
  let rest = s.trim();
  while (rest.length > maxLen) {
    const space = rest.lastIndexOf(' ', maxLen);
    const at = space > maxLen / 4 ? space : maxLen;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/** Text → ordered synthesis units: sentences joined up to `maxChars` per paragraph; first unit = first sentence. */
export function speechUnits(
  text: string,
  opts: { maxChars?: number; firstMaxChars?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? MAX_UNIT_CHARS;
  const firstMax = Math.min(opts.firstMaxChars ?? FIRST_UNIT_CHARS, maxChars);
  const units: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const { ready, rest } = takeSentences(para.replace(/\s+/g, ' ').trim(), { maxLen: maxChars });
    let unit = '';
    for (const sentence of [...ready, rest]) {
      let pieces = splitLong(sentence, maxChars);
      if (units.length === 0 && pieces.length > 0) {
        const [head, ...tail] = splitLong(pieces[0], firstMax);
        units.push(head);
        pieces = [...tail, ...pieces.slice(1)];
      }
      for (const s of pieces) {
        if (unit && unit.length + s.length + 1 > maxChars) {
          units.push(unit);
          unit = '';
        }
        unit = unit ? `${unit} ${s}` : s;
      }
    }
    if (unit) units.push(unit);
  }
  return units;
}
