import { Button, Group, Paper, Text } from '@mantine/core';
import { FiTrash2 } from 'react-icons/fi';

const nf = new Intl.NumberFormat('id-ID');

type Props = {
  count: number;
  noun: string;
  deleting: boolean;
  onClear: () => void;
  onDelete: () => void;
};

/** Sticky-feeling bar shown while rows are checked: count, cancel, bulk delete. */
export function SelectionBar({ count, noun, deleting, onClear, onDelete }: Props) {
  if (count === 0) return null;
  return (
    <Paper withBorder radius="md" p="sm" bg="var(--mantine-primary-color-light)">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text size="sm" fw={500}>
          {nf.format(count)} {noun} dipilih
        </Text>
        <Group gap="xs">
          <Button size="xs" variant="subtle" color="gray" onClick={onClear}>
            Batal pilih
          </Button>
          <Button
            size="xs"
            color="red"
            leftSection={<FiTrash2 size={13} />}
            loading={deleting}
            onClick={onDelete}
          >
            Hapus terpilih
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
