import { Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type EngineAction, type EngineKind, formatMs, runEngineAction } from '~/lib/engines-api';

const LABEL: Record<EngineKind, string> = { stt: 'STT', tts: 'TTS' };
const COPY: Record<EngineAction, { title: string; body: string; confirm: string; done: string }> = {
  warmup: {
    title: 'Muat model sekarang?',
    body: 'Model dimuat ke memori sekarang agar request pertama tidak menunggu. Butuh RAM tambahan dan beberapa detik.',
    confirm: 'Warmup engine',
    done: 'dimuat',
  },
  unload: {
    title: 'Keluarkan model dari memori?',
    body: 'Model akan dikeluarkan dari memori; request berikutnya memuat ulang (STT ±14 dtk).',
    confirm: 'Unload engine',
    done: 'dikeluarkan dari memori',
  },
};

/** Confirmed warmup/unload per engine with loading state and notifications. */
export function useEngineActions() {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: (v: { kind: EngineKind; action: EngineAction }) =>
      runEngineAction(v.kind, v.action),
    onSuccess: async (r, v) => {
      await qc.invalidateQueries({ queryKey: ['engines'] });
      notifications.show({
        color: 'teal',
        message: `Engine ${LABEL[v.kind]} ${COPY[v.action].done} (${formatMs(r.ms)}).`,
      });
    },
    onError: (e: Error, v) =>
      notifications.show({
        color: 'red',
        title: `Gagal ${v.action} engine ${LABEL[v.kind]}`,
        message: e.message,
      }),
  });

  const confirm = (kind: EngineKind, action: EngineAction) =>
    modals.openConfirmModal({
      title: `${COPY[action].title} (${LABEL[kind]})`,
      children: <Text size="sm">{COPY[action].body}</Text>,
      labels: { confirm: COPY[action].confirm, cancel: 'Batal' },
      confirmProps: { color: action === 'unload' ? 'orange' : 'teal' },
      onConfirm: () => run.mutate({ kind, action }),
    });

  const pending = (kind: EngineKind, action: EngineAction) =>
    run.isPending && run.variables?.kind === kind && run.variables?.action === action;

  return { confirm, pending, busy: run.isPending };
}
