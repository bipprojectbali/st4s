import { openapi } from '@elysia/openapi';
import { Elysia } from 'elysia';
import { memoryGuardPlugin } from '../memory-guard/plugin';
import { requireV1Caller } from './auth';
import { modelsApi } from './models';
import { openApiDocumentation } from './openapi.doc';
import { realtimeApi } from './realtime';
import { speechApi } from './speech';
import { transcriptionsApi } from './transcriptions';

/** GET /api/v1/openapi.json (JSON only, no UI); requiredScope maps it to ANY_KEY so requireV1Caller refuses anonymous callers. */
const openapiSpec = new Elysia().onBeforeHandle(requireV1Caller).use(
  openapi({
    provider: null,
    specPath: '/openapi.json',
    documentation: openApiDocumentation,
    // The plugin sees every route of the whole app; only /api/v1/* belongs in this spec.
    exclude: { paths: [/^(?!\/api\/v1\/)/] },
  }),
);

/** OpenAI-compatible audio API, served at /api/v1 (clients use base_url = <host>/api/v1). */
export const v1Api = new Elysia({ prefix: '/v1' })
  .use(modelsApi)
  .use(openapiSpec)
  .use(memoryGuardPlugin)
  .use(speechApi)
  .use(transcriptionsApi)
  .use(realtimeApi);
