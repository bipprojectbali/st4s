import { Elysia } from 'elysia';
import { speechApi } from './speech';

/** OpenAI-compatible audio API, served at /api/v1 (clients use base_url = <host>/api/v1). */
export const v1Api = new Elysia({ prefix: '/v1' }).use(speechApi);
