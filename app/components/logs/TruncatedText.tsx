import { Text, type TextProps, Tooltip } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

type Props = TextProps & {
  children: string;
  /** Max tooltip width; long values (paths, UAs) wrap inside it. */
  tooltipMaw?: number;
};

/**
 * Single-line ellipsized text that reveals the full value in a tooltip — but
 * only when it is actually clipped, so short values never get a pointless
 * tooltip. Re-measures on resize.
 */
export function TruncatedText({ children, tooltipMaw = 420, ...textProps }: Props) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <Tooltip
      label={children}
      disabled={!clipped}
      withArrow
      multiline
      maw={tooltipMaw}
      openDelay={250}
    >
      <Text ref={ref} truncate {...textProps}>
        {children}
      </Text>
    </Tooltip>
  );
}
