/** `import p from './x.wav' with { type: 'file' }` → a path (on disk from source, `/$bunfs/...` in the binary). */
declare module '*.wav' {
  const path: string;
  export default path;
}
