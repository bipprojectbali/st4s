/** Elysia plugin: 503 JSON for /api while maintenance mode blocks the caller. Register after rate limiting. */
import { Elysia } from 'elysia';
import { getBranding } from '../settings-branding';
import { maintenanceGate } from '../settings-maintenance';
import { isV1Path, v1Error } from '../v1/errors';

/** /api/v1 answers in OpenAI error shape; the gate's message and Retry-After are kept. */
async function asV1(blocked: Response): Promise<Response> {
  const { message } = (await blocked.json()) as { message?: string };
  const retryAfter = blocked.headers.get('retry-after');
  return v1Error(503, message ?? 'Service is under maintenance.', {
    code: 'maintenance',
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
  });
}

export function maintenancePlugin() {
  return new Elysia({ name: 'maintenance' }).onBeforeHandle(
    { as: 'global' },
    async ({ request }) => {
      const blocked = await maintenanceGate(request, (await getBranding()).appName);
      if (!blocked) return;
      return isV1Path(new URL(request.url).pathname) ? asV1(blocked) : blocked;
    },
  );
}
