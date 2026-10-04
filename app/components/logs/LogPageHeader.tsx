import { ActionIcon, Button, Group, Menu, Text, Title, Tooltip } from '@mantine/core';
import { FiDownload, FiMoreVertical, FiRefreshCw, FiTrash2 } from 'react-icons/fi';

const nf = new Intl.NumberFormat('id-ID');

type Props = {
  title: string;
  description: string;
  exportHref: string;
  exportMaxRows: number;
  canExport: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Disables the destructive menu items (nothing to purge). */
  hasData: boolean;
  onPurgeOld: () => void;
  onClearAll: () => void;
};

/** Title + description with Export CSV, Refresh, and a menu holding destructive log actions. */
export function LogPageHeader(p: Props) {
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap">
      <div>
        <Title order={3}>{p.title}</Title>
        <Text size="sm" c="dimmed">
          {p.description}
        </Text>
      </div>
      <Group gap="xs" wrap="wrap" justify="flex-end">
        <Tooltip
          label={`Unduh CSV sesuai filter aktif (maks. ${nf.format(p.exportMaxRows)} baris)`}
          withArrow
        >
          <Button
            component="a"
            href={p.exportHref}
            download
            size="sm"
            variant="default"
            leftSection={<FiDownload size={14} />}
            disabled={!p.canExport}
            onClick={(e) => {
              // Anchors ignore `disabled`; block navigation when there is nothing to export.
              if (!p.canExport) e.preventDefault();
            }}
          >
            Export CSV
          </Button>
        </Tooltip>
        <Button
          size="sm"
          variant="light"
          leftSection={<FiRefreshCw size={14} />}
          loading={p.refreshing}
          onClick={p.onRefresh}
        >
          Refresh
        </Button>
        <Menu position="bottom-end" withArrow shadow="md">
          <Menu.Target>
            <ActionIcon variant="default" size="lg" aria-label="Aksi lainnya">
              <FiMoreVertical size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Pembersihan log</Menu.Label>
            <Menu.Item
              leftSection={<FiTrash2 size={14} />}
              onClick={p.onPurgeOld}
              disabled={!p.hasData}
            >
              Purge log lebih dari 30 hari
            </Menu.Item>
            <Menu.Item
              color="red"
              leftSection={<FiTrash2 size={14} />}
              onClick={p.onClearAll}
              disabled={!p.hasData}
            >
              Hapus semua log
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}
