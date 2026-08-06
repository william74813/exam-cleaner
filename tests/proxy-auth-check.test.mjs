import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/entry.js';

const ORIGIN = 'https://william74813.github.io';
const URL = 'https://proxy.example.workers.dev/auth-check';

function env(overrides = {}) {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    GEMINI_API_KEY: 'gemini-secret',
    ACCESS_TOKEN: 'access-secret',
    GEMINI_MODEL: 'gemini-3.1-flash-image',
    ...overrides
  };
}

function request(token = 'access-secret', origin = ORIGIN) {
  return new Request(URL, {
    method: 'GET',
    headers: {
      Origin: origin,
      'X-Exam-Cleaner-Token': token
    }
  });
}

test('auth-check confirms a valid token without calling Gemini', async () => {
  const response = await worker.fetch(request(), env());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.authorized, true);
  assert.equal(payload.ready, true);
  assert.equal(payload.apiVersion, 'exam-clean-v2');
});

test('auth-check rejects a wrong token', async () => {
  const response = await worker.fetch(request('wrong-token'), env());
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.authorized, false);
});

test('auth-check reports missing Worker secrets', async () => {
  const response = await worker.fetch(request(), env({ GEMINI_API_KEY: '' }));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.ready, false);
});
