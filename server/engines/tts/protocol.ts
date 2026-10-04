/** IPC messages between the TTS engine (parent) and its child (serialization: 'advanced'). */

export type ParentMsg =
  | { type: 'load'; modelDir: string; threads: number }
  | {
      type: 'synth';
      id: number;
      text: string;
      voice: string;
      language: string;
      speed: number;
      steps: number;
    };

export type ChildMsg =
  | { type: 'loaded'; sampleRate: number; loadMs: number; rss: number }
  | { type: 'result'; id: number; pcm: Float32Array; rss: number }
  | { type: 'error'; id?: number; message: string; rss: number };
