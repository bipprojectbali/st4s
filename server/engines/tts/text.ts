// Ported from supertone-inc/supertonic nodejs/helper.js (MIT): text normalisation, indexing, chunking.

/** Language codes Supertonic 3 accepts ("na" = language-agnostic). */
export const TTS_LANGUAGES = [
  'en',
  'ko',
  'ja',
  'ar',
  'bg',
  'cs',
  'da',
  'de',
  'el',
  'es',
  'et',
  'fi',
  'fr',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'lt',
  'lv',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'tr',
  'uk',
  'vi',
  'na',
] as const;

const EMOJI =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

const CHAR_REPLACEMENTS: Record<string, string> = {
  '–': '-',
  '‑': '-',
  '—': '-',
  _: ' ',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '´': "'",
  '`': "'",
  '[': ' ',
  ']': ' ',
  '|': ' ',
  '/': ' ',
  '#': ' ',
  '→': ' ',
  '←': ' ',
};

const EXPR_REPLACEMENTS: Record<string, string> = {
  '@': ' at ',
  'e.g.,': 'for example, ',
  'i.e.,': 'that is, ',
};

/** True when `lang` is a Supertonic language code. */
export function isTtsLanguage(lang: string): boolean {
  return (TTS_LANGUAGES as readonly string[]).includes(lang);
}

/** Normalise text and wrap it in language tags; expression tags like <laugh> pass through. */
export function preprocessText(input: string, lang: string): string {
  if (!isTtsLanguage(lang)) throw new Error(`Unsupported TTS language "${lang}"`);
  let text = input.normalize('NFKD').replace(EMOJI, '');
  for (const [k, v] of Object.entries(CHAR_REPLACEMENTS)) text = text.replaceAll(k, v);
  text = text.replace(/[♥☆♡©\\]/g, '');
  for (const [k, v] of Object.entries(EXPR_REPLACEMENTS)) text = text.replaceAll(k, v);
  text = text
    .replace(/ ,/g, ',')
    .replace(/ \./g, '.')
    .replace(/ !/g, '!')
    .replace(/ \?/g, '?')
    .replace(/ ;/g, ';')
    .replace(/ :/g, ':')
    .replace(/ '/g, "'");
  text = text.replace(/"{2,}/g, '"').replace(/'{2,}/g, "'");
  text = text.replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) text += '.';
  return `<${lang}>${text}</${lang}>`;
}

/** Map processed text to model token ids via the unicode indexer (-1 = unknown, as upstream). */
export function textToIds(text: string, indexer: readonly number[]): BigInt64Array {
  const chars = Array.from(text);
  const ids = new BigInt64Array(chars.length);
  for (let i = 0; i < chars.length; i++) ids[i] = BigInt(indexer[chars[i].charCodeAt(0)] ?? -1);
  return ids;
}

const SENTENCE_SPLIT =
  /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/;

/** Split text into paragraph/sentence chunks of at most ~maxLen chars. */
export function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  for (const raw of text.trim().split(/\n\s*\n+/)) {
    const paragraph = raw.trim();
    if (!paragraph) continue;
    let current = '';
    for (const sentence of paragraph.split(SENTENCE_SPLIT)) {
      if (current.length + sentence.length + 1 <= maxLen) {
        current += (current ? ' ' : '') + sentence;
      } else {
        if (current) chunks.push(current.trim());
        current = sentence;
      }
    }
    if (current) chunks.push(current.trim());
  }
  return chunks;
}

/** Max chunk length per language (upstream: 120 for ko/ja, 300 otherwise). */
export function maxChunkLen(lang: string): number {
  return lang === 'ko' || lang === 'ja' ? 120 : 300;
}
