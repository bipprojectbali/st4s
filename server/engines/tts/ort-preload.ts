// In the compiled binary Bun extracts onnxruntime_binding.node to $TMPDIR, so its @rpath/@loader_path
// cannot find libonnxruntime. Loading the lib by absolute path first lets dyld/ld.so match its install name/SONAME.

import { dlopen, FFIType } from 'bun:ffi';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { st4sLibDir } from '../../st4s-home';

const LIB_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'libonnxruntime.1.dylib',
  linux: 'libonnxruntime.so.1',
};

/** Absolute path of the bundled libonnxruntime for `platform`, or null when there is no lib dir / unsupported OS. */
export function ortLibPath(
  libDir: string | null,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const name = LIB_NAMES[platform];
  return libDir && name ? join(libDir, name) : null;
}

let handle: ReturnType<typeof dlopen> | null = null;

/** Load libonnxruntime from the st4s lib dir before onnxruntime-node is imported; no-op outside the binary. */
export function preloadOrt(
  standalone: boolean = Bun.isStandaloneExecutable,
  libDir: string | null = st4sLibDir(),
): void {
  if (!standalone || handle) return;
  const path = ortLibPath(libDir);
  if (!path) return;
  if (!existsSync(path)) {
    throw new Error(
      `libonnxruntime not found at ${path} — reinstall the st4s bundle or run \`st4s doctor\``,
    );
  }
  // bun:ffi requires at least one symbol; the handle is kept so the lib stays loaded for the process lifetime.
  handle = dlopen(path, { OrtGetApiBase: { args: [], returns: FFIType.ptr } });
}
