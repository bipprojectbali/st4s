import { Elysia } from 'elysia';
import { modelsApi } from './models';
import { speechApi } from './speech';
import { transcriptionsApi } from './transcriptions';

/** OpenAI-compatible audio API, served at /api/v1 (clients use base_url = <host>/api/v1). */
export const v1Api = new Elysia({ prefix: '/v1' }).use(modelsApi).use(speechApi).use(transcriptionsApi);
