/** /api/v1 auth: routes that need a scope accept an API key (checked by the api-key plugin) or a signed-in session. */
import { getApiKeyIdentity } from '../api-keys/identity';
import { requiredScope } from '../api-keys/scopes';
import { resolveActor } from '../guard';
import { v1Error } from './errors';

/** beforeHandle hook: 401 OpenAI-shaped when a protected v1 route is called anonymously. */
export async function requireV1Caller({ request }: { request: Request }): Promise<Response | undefined> {
  if (!requiredScope(request.method, new URL(request.url).pathname)) return;
  if (getApiKeyIdentity(request)) return;
  if (await resolveActor(request)) return;
  return v1Error(
    401,
    'Kredensial tidak ada atau tidak valid. Kirim "Authorization: Bearer <API key>" atau login.',
    { code: 'invalid_api_key' },
  );
}
