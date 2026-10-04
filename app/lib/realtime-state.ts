/** Pure reducer: OpenAI Realtime transcription server events (+ local socket status) → UI state. */
import type {
  ConversationItemInputAudioTranscriptionCompletedEvent,
  ConversationItemInputAudioTranscriptionDeltaEvent,
  ConversationItemInputAudioTranscriptionFailedEvent,
  InputAudioBufferCommittedEvent,
  InputAudioBufferSpeechStartedEvent,
  InputAudioBufferSpeechStoppedEvent,
  RealtimeErrorEvent,
} from 'openai/resources/realtime/realtime';
import { realtimeErrorMessage } from './realtime-protocol';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'lost';
export type TurnStatus = 'speaking' | 'waiting' | 'transcribing' | 'done' | 'failed';
export type RealtimeTurn = {
  itemId: string;
  status: TurnStatus;
  text: string;
  error: string | null;
};
export type RealtimeState = {
  connection: ConnectionStatus;
  sessionReady: boolean;
  speaking: boolean;
  turns: RealtimeTurn[];
  lastError: string | null;
};

/** Server event as parsed JSON; known types are narrowed to the SDK shapes inside the reducer. */
export type IncomingEvent = { type: string } & Record<string, unknown>;
export type RealtimeAction =
  | IncomingEvent
  | { type: 'local.connecting' }
  | { type: 'local.open' }
  | { type: 'local.closed'; lost: boolean };

export const initialRealtimeState: RealtimeState = {
  connection: 'idle',
  sessionReady: false,
  speaking: false,
  turns: [],
  lastError: null,
};

const RANK: Record<TurnStatus, number> = {
  speaking: 0,
  waiting: 1,
  transcribing: 2,
  done: 3,
  failed: 3,
};

/** Inserts a new turn after `afterId` when known (server ordering), else appends; existing turns keep their slot. */
function upsert(
  turns: RealtimeTurn[],
  itemId: string,
  patch: (t: RealtimeTurn) => RealtimeTurn,
  afterId?: string | null,
): RealtimeTurn[] {
  const i = turns.findIndex((t) => t.itemId === itemId);
  if (i >= 0) return turns.map((t, j) => (j === i ? patch(t) : t));
  const fresh = patch({ itemId, status: 'speaking', text: '', error: null });
  const after = afterId ? turns.findIndex((t) => t.itemId === afterId) : -1;
  if (after < 0) return [...turns, fresh];
  return [...turns.slice(0, after + 1), fresh, ...turns.slice(after + 1)];
}

/** Moves a turn forward only — a late event never downgrades a finished turn. */
const advance = (status: TurnStatus) => (t: RealtimeTurn) =>
  RANK[status] > RANK[t.status] ? { ...t, status } : t;

/** Applies one server event or local status change. Unknown event types leave state untouched. */
export function realtimeReducer(state: RealtimeState, action: RealtimeAction): RealtimeState {
  switch (action.type) {
    case 'local.connecting':
      return { ...initialRealtimeState, connection: 'connecting' };
    case 'local.open':
      return { ...state, connection: 'open' };
    case 'local.closed':
      return {
        ...state,
        connection: (action as { lost: boolean }).lost ? 'lost' : 'idle',
        sessionReady: false,
        speaking: false,
      };
    case 'session.created':
    case 'session.updated':
    case 'transcription_session.created':
    case 'transcription_session.updated':
      return { ...state, sessionReady: true };
    case 'input_audio_buffer.speech_started': {
      const e = action as unknown as InputAudioBufferSpeechStartedEvent;
      return { ...state, speaking: true, turns: upsert(state.turns, e.item_id, (t) => t) };
    }
    case 'input_audio_buffer.speech_stopped': {
      const e = action as unknown as InputAudioBufferSpeechStoppedEvent;
      return {
        ...state,
        speaking: false,
        turns: upsert(state.turns, e.item_id, advance('waiting')),
      };
    }
    case 'input_audio_buffer.committed': {
      const e = action as unknown as InputAudioBufferCommittedEvent;
      const turns = upsert(state.turns, e.item_id, advance('waiting'), e.previous_item_id);
      return { ...state, turns };
    }
    case 'conversation.item.input_audio_transcription.delta': {
      const e = action as unknown as ConversationItemInputAudioTranscriptionDeltaEvent;
      const turns = upsert(state.turns, e.item_id, (t) =>
        RANK[t.status] >= RANK.done
          ? t
          : { ...t, status: 'transcribing', text: t.text + (e.delta ?? '') },
      );
      return { ...state, turns };
    }
    case 'conversation.item.input_audio_transcription.completed': {
      const e = action as unknown as ConversationItemInputAudioTranscriptionCompletedEvent;
      const turns = upsert(state.turns, e.item_id, (t) => ({
        ...t,
        status: 'done',
        text: e.transcript,
        error: null,
      }));
      return { ...state, turns };
    }
    case 'conversation.item.input_audio_transcription.failed': {
      const e = action as unknown as ConversationItemInputAudioTranscriptionFailedEvent;
      const detail = e.error?.message ? `: ${e.error.message}` : '. Coba ucapkan lagi.';
      const turns = upsert(state.turns, e.item_id, (t) => ({
        ...t,
        status: 'failed',
        error: `Transkripsi giliran ini gagal${detail}`,
      }));
      return { ...state, turns };
    }
    case 'error': {
      const e = action as unknown as RealtimeErrorEvent;
      return { ...state, lastError: realtimeErrorMessage(e.error) };
    }
    default:
      return state;
  }
}
