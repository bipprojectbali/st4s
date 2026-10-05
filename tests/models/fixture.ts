// test-only: local HF-like server + tiny manifest so no real model is ever downloaded.
import { type ModelFile, type ModelSpec, modelManifest } from '../../server/models/manifest';

export function sha256(data: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(data).digest('hex');
}

export function bytes(n: number, seed: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251);
}

export const FIXTURE_FILES: Record<string, Uint8Array<ArrayBuffer>> = {
  'stt/a.bin': bytes(4096, 1),
  'stt/b.bin': bytes(1000, 2),
  'tts/onnx/c.onnx': bytes(3000, 3),
  'tts/voice_styles/F1.json': bytes(500, 4),
};

export function fixtureSpecs(overrides: Partial<Record<string, Partial<ModelSpec>>> = {}) {
  return Object.entries(FIXTURE_FILES).map(([dest, data]): ModelSpec => {
    const group = dest.startsWith('tts/') ? 'tts' : 'stt';
    return {
      id: dest,
      group,
      dest,
      repo: 'test/repo',
      rev: 'abc123',
      path: dest.replace(/^(stt|tts)\//, ''),
      size: data.byteLength,
      sha256: sha256(data),
      license: group === 'tts' ? 'OpenRAIL-M' : 'MIT',
      ...overrides[dest],
    };
  });
}

export interface Fixture {
  url: string;
  requests: { path: string; range: string | null }[];
  ignoreRange: boolean;
  manifest(specs?: ModelSpec[]): ModelFile[];
  stop(): void;
}

export function startFixture(): Fixture {
  const byPath = new Map(
    Object.values(fixtureSpecs()).map((s) => [`/${s.repo}/resolve/${s.rev}/${s.path}`, s.dest]),
  );
  const fx: Fixture = {
    url: '',
    requests: [],
    ignoreRange: false,
    manifest: (specs = fixtureSpecs()) =>
      modelManifest(specs, { ST4S_MODELS_BASE_URL: `${fx.url}/` }),
    stop: () => server.stop(true),
  };
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const range = req.headers.get('range');
      fx.requests.push({ path: url.pathname, range });
      const dest = byPath.get(url.pathname);
      if (!dest) return new Response('not found', { status: 404 });
      const data = FIXTURE_FILES[dest];
      const m = range?.match(/^bytes=(\d+)-$/);
      if (m && !fx.ignoreRange) {
        const start = Number(m[1]);
        if (start >= data.byteLength) return new Response(null, { status: 416 });
        return new Response(data.slice(start), {
          status: 206,
          headers: { 'content-range': `bytes ${start}-${data.byteLength - 1}/${data.byteLength}` },
        });
      }
      return new Response(data);
    },
  });
  fx.url = server.url.origin;
  return fx;
}
