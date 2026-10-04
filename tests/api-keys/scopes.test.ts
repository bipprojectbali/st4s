import { describe, expect, it } from 'bun:test';
import {
  isPublicRead,
  requiredScope,
  roleAllowsScope,
  scopesForRole,
} from '../../server/api-keys/scopes';

describe('requiredScope', () => {
  it('maps routes to scopes by prefix and method', () => {
    expect(requiredScope('GET', '/api/analytics/visits')).toBe('analytics:read');
    expect(requiredScope('DELETE', '/api/analytics/visits')).toBe('analytics:write');
    expect(requiredScope('DELETE', '/api/analytics/purge')).toBe('analytics:write');
    expect(requiredScope('GET', '/api/admin/users')).toBe('users:read');
    expect(requiredScope('POST', '/api/admin/users/x/ban')).toBe('users:write');
    expect(requiredScope('GET', '/api/settings')).toBe('settings:read');
    expect(requiredScope('PUT', '/api/settings/rate-limit')).toBe('settings:write');
    expect(requiredScope('POST', '/api/posts')).toBe('posts:write');
    expect(requiredScope('GET', '/api/me/logins')).toBe('me:read');
    expect(requiredScope('POST', '/api/mcp')).toBe('mcp');
    expect(requiredScope('GET', '/api/mcp')).toBe('mcp');
  });
  it('maps the OpenAI-compatible /api/v1 audio routes', () => {
    expect(requiredScope('POST', '/api/v1/audio/transcriptions')).toBe('stt:transcribe');
    expect(requiredScope('POST', '/api/v1/audio/translations')).toBe('stt:transcribe');
    expect(requiredScope('POST', '/api/v1/audio/speech')).toBe('tts:speak');
    expect(requiredScope('GET', '/api/v1/audio/transcriptions')).toBeNull();
    expect(requiredScope('GET', '/api/v1/realtime')).toBe('stt:transcribe');
    expect(requiredScope('POST', '/api/v1/realtime')).toBeNull();
    expect(isPublicRead('GET', '/api/v1/realtime')).toBe(false);
    expect(requiredScope('GET', '/api/v1/models')).toBeNull();
    expect(isPublicRead('GET', '/api/v1/models')).toBe(true);
    expect(isPublicRead('GET', '/api/v1/models/whisper-1')).toBe(true);
    expect(isPublicRead('GET', '/api/v1/audio/voices')).toBe(true);
    expect(isPublicRead('POST', '/api/v1/models')).toBe(false);
    expect(isPublicRead('POST', '/api/v1/audio/transcriptions')).toBe(false);
  });
  it('blocks auth, key management (admin and personal), resets and unknown routes', () => {
    expect(requiredScope('POST', '/api/auth/sign-in/email')).toBeNull();
    expect(requiredScope('GET', '/api/api-keys')).toBeNull();
    expect(requiredScope('GET', '/api/me/api-keys')).toBeNull();
    expect(requiredScope('POST', '/api/me/api-keys/x/rotate')).toBeNull();
    expect(requiredScope('POST', '/api/ops/reset/limiter')).toBeNull();
    expect(requiredScope('GET', '/api/engines')).toBeNull();
    expect(requiredScope('POST', '/api/engines/stt/warmup')).toBeNull();
    expect(requiredScope('DELETE', '/api/logs')).toBeNull();
    expect(requiredScope('GET', '/api/posts')).toBeNull();
    expect(isPublicRead('GET', '/api/posts')).toBe(true);
    expect(isPublicRead('POST', '/api/posts')).toBe(false);
    expect(isPublicRead('GET', '/api/version')).toBe(true);
  });
});

describe('role ceiling', () => {
  it('never lets a key exceed its owner role', () => {
    expect(roleAllowsScope('user', 'posts:write')).toBe(true);
    expect(roleAllowsScope('user', 'users:read')).toBe(false);
    expect(roleAllowsScope('admin', 'users:write')).toBe(true);
    expect(roleAllowsScope('admin', 'settings:write')).toBe(false);
    expect(roleAllowsScope('super-admin', 'settings:write')).toBe(true);
    expect(roleAllowsScope('admin', 'mcp')).toBe(false);
    expect(roleAllowsScope('super-admin', 'mcp')).toBe(true);
    expect(roleAllowsScope('user', 'stt:transcribe')).toBe(true);
    expect(roleAllowsScope('user', 'tts:speak')).toBe(true);
    expect(scopesForRole('user')).toEqual([
      'posts:write',
      'me:read',
      'stt:transcribe',
      'tts:speak',
    ]);
  });
});
