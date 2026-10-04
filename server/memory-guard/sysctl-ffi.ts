/** darwin-only integer sysctl reader over libc sysctlbyname (bun:ffi): ~2 µs per read, no process spawn. */
import { dlopen, FFIType } from 'bun:ffi';
import { logger } from '../logger';

const LIBC = '/usr/lib/libSystem.B.dylib';

const g = globalThis as typeof globalThis & { __s4sSysctlInt?: (name: string) => number };

/** Build a reader for 32-bit integer sysctls; throws when libc cannot be opened. */
export function createSysctlInt(): (name: string) => number {
  const lib = dlopen(LIBC, {
    sysctlbyname: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64],
      returns: FFIType.i32,
    },
  });
  const out = new Int32Array(1);
  const len = new BigUint64Array(1);
  const names = new Map<string, Buffer>();
  return (name) => {
    let cName = names.get(name);
    if (!cName) {
      cName = Buffer.from(`${name}\0`);
      names.set(name, cName);
    }
    len[0] = 4n;
    const rc = lib.symbols.sysctlbyname(cName, out, len, null, 0);
    if (rc !== 0) throw new Error(`sysctlbyname(${name}) returned ${rc}`);
    return out[0];
  };
}

/** Register the FFI reader on globalThis for server/system-memory.ts (darwin only, idempotent, falls back to spawn on failure). */
export function installSysctlFfi(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'darwin') return false;
  if (g.__s4sSysctlInt) return true;
  try {
    g.__s4sSysctlInt = createSysctlInt();
    return true;
  } catch (err) {
    logger.warn({ err, lib: LIBC }, 'sysctlbyname via FFI unavailable; memory reads spawn sysctl');
    return false;
  }
}
