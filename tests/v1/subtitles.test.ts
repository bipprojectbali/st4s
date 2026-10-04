import { describe, expect, it } from 'bun:test';
import { toSrt, toVtt } from '../../server/v1/subtitles';

const segments = [
  { id: 0, start: 0, end: 1.5, text: 'Halo dunia.' },
  { id: 1, start: 1.5, end: 3725.042, text: ' Apa kabar? ' },
  { id: 2, start: 4000, end: 4001, text: '   ' },
];

describe('subtitles', () => {
  it('builds numbered SRT cues with comma milliseconds and skips empty text', () => {
    expect(toSrt(segments)).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nHalo dunia.\n\n2\n00:00:01,500 --> 01:02:05,042\nApa kabar?\n',
    );
  });

  it('builds WEBVTT with dot milliseconds', () => {
    const vtt = toVtt(segments);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.500\nHalo dunia.');
    expect(vtt).toContain('00:00:01.500 --> 01:02:05.042\nApa kabar?');
    expect(vtt).not.toContain(',');
  });

  it('handles no segments', () => {
    expect(toSrt([])).toBe('');
    expect(toVtt([])).toBe('WEBVTT\n');
  });
});
