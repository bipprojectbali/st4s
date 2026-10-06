import { Box } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { useEffect, useState } from 'react';

const FLASH_MS = 1000;

/** Small dot that lights up while fetching and briefly after each data update past the initial load. */
export function RefreshDot({
  isFetching,
  dataUpdatedAt,
  loadedAt,
}: {
  isFetching: boolean;
  dataUpdatedAt: number;
  loadedAt: number;
}) {
  const [flash, setFlash] = useState(false);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (dataUpdatedAt === loadedAt) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(t);
  }, [dataUpdatedAt, loadedAt]);
  const updating = isFetching || flash;

  return (
    <Box
      component="span"
      aria-hidden
      display="inline-block"
      w={6}
      h={6}
      bg="teal.6"
      style={{
        borderRadius: '50%',
        verticalAlign: 'middle',
        opacity: updating ? 0.9 : 0.2,
        transition: reduceMotion ? 'none' : 'opacity 400ms ease-in-out',
      }}
    />
  );
}
