import { describe, expect, test } from 'bun:test';
import {
  chunkText,
  isTtsLanguage,
  maxChunkLen,
  preprocessText,
  textToIds,
} from '../../server/engines/tts/text';

describe('preprocessText', () => {
  test('wraps in language tags and appends a period', () => {
    expect(preprocessText('Halo dunia', 'id')).toBe('<id>Halo dunia.</id>');
  });

  test('keeps expression tags untouched', () => {
    const out = preprocessText('Wah <laugh> lucu sekali <breath> ya <sigh>!', 'id');
    expect(out).toBe('<id>Wah <laugh> lucu sekali <breath> ya <sigh>!</id>');
  });

  test('normalises quotes, dashes, brackets and spacing', () => {
    expect(preprocessText('“Hi” — it’s [ok] fine , right ?', 'en')).toBe(
      `<en>"Hi" - it's ok fine, right?</en>`,
    );
  });

  test('removes emoji and collapses whitespace', () => {
    expect(preprocessText('Halo 😀   semua\n\nnya', 'id')).toBe('<id>Halo semua nya.</id>');
  });

  test('expands known expressions', () => {
    expect(preprocessText('mail me@x', 'en')).toBe('<en>mail me at x.</en>');
  });

  test('collapses duplicate quotes and keeps closing punctuation', () => {
    expect(preprocessText('He said ""yes""', 'en')).toBe('<en>He said "yes"</en>');
  });

  test('rejects unknown languages', () => {
    expect(() => preprocessText('x', 'xx')).toThrow('Unsupported TTS language "xx"');
    expect(isTtsLanguage('id')).toBe(true);
    expect(isTtsLanguage('zz')).toBe(false);
  });
});

describe('textToIds', () => {
  test('maps code points through the indexer and unknowns to -1', () => {
    const indexer: number[] = [];
    indexer['a'.charCodeAt(0)] = 5;
    indexer['<'.charCodeAt(0)] = 7;
    expect(Array.from(textToIds('<a?', indexer))).toEqual([7n, 5n, -1n]);
  });
});

describe('chunkText', () => {
  test('keeps short text as one chunk', () => {
    expect(chunkText('One. Two.', 300)).toEqual(['One. Two.']);
  });

  test('splits on sentence boundaries when over maxLen', () => {
    expect(chunkText('First sentence. Second sentence! Third?', 20)).toEqual([
      'First sentence.',
      'Second sentence!',
      'Third?',
    ]);
  });

  test('splits paragraphs and does not split after abbreviations', () => {
    expect(chunkText('Dr. Smith came.\n\nNext para.', 10)).toEqual([
      'Dr. Smith came.',
      'Next para.',
    ]);
  });

  test('uses shorter chunks for ko/ja', () => {
    expect(maxChunkLen('ja')).toBe(120);
    expect(maxChunkLen('id')).toBe(300);
  });
});
