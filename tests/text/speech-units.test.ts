import { describe, expect, test } from 'bun:test';
import { speechUnits, splitLong, takeSentences } from '../../server/text/speech-units';

describe('takeSentences', () => {
  test('splits on terminator + whitespace, keeps decimals and the unfinished tail', () => {
    const { ready, rest } = takeSentences('Harga naik 3.14 persen. Benarkah? Ya');
    expect(ready).toEqual(['Harga naik 3.14 persen.', 'Benarkah?']);
    expect(rest).toBe('Ya');
  });

  test('force-flushes a terminator-less tail past maxLen at a word boundary', () => {
    const long = 'kata '.repeat(60).trim();
    const { ready, rest } = takeSentences(long, { maxLen: 100 });
    expect(ready.length).toBeGreaterThan(0);
    for (const s of ready) expect(s.length).toBeLessThanOrEqual(100);
    expect(rest.length).toBeLessThanOrEqual(100);
  });
});

describe('splitLong', () => {
  test('pieces never exceed maxLen and keep every word', () => {
    const s = 'satu dua tiga empat lima enam tujuh delapan sembilan sepuluh';
    const pieces = splitLong(s, 15);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(15);
    expect(pieces.join(' ')).toBe(s);
  });
});

describe('speechUnits', () => {
  test('first unit is only the first sentence; the rest is joined up to maxChars', () => {
    const units = speechUnits('Halo. Ini kalimat kedua. Ini ketiga. Dan keempat.', {
      maxChars: 400,
    });
    expect(units).toEqual(['Halo.', 'Ini kalimat kedua. Ini ketiga. Dan keempat.']);
  });

  test('units never cross a paragraph break', () => {
    const units = speechUnits('Satu. Dua.\n\nTiga. Empat.');
    expect(units).toEqual(['Satu.', 'Dua.', 'Tiga. Empat.']);
  });

  test('no unit exceeds maxChars, even one very long sentence', () => {
    const text = `${'panjang '.repeat(200)}selesai. Pendek.`;
    const units = speechUnits(text, { maxChars: 120, firstMaxChars: 60 });
    expect(units[0].length).toBeLessThanOrEqual(60);
    for (const u of units) expect(u.length).toBeLessThanOrEqual(120);
    expect(units.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' ').trim());
  });

  test('single sentence without terminator is one unit; blank input is none', () => {
    expect(speechUnits('  halo dunia  ')).toEqual(['halo dunia']);
    expect(speechUnits('   \n\n  ')).toEqual([]);
  });
});
