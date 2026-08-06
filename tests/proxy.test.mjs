import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../worker/src/index.js';

const ORIGIN = 'https://william74813.github.io';
const ENDPOINT = 'https://proxy.example.workers.dev/api/clean';

function env(overrides = {}) {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    GEMINI_MODEL: 'gemini-3.1-flash-image',
    GEMINI_API_KEY: 'test-gemini-key',
    ACCESS_TOKEN: 'test-access-token',
    CLEAN_RATE_LIMITER: {
      async limit() {
        return { success: true };
      }
    },
    ...overrides
  };
}

function cleanRequest({ origin = ORIGIN, token = 'test-access-token', body = {} } = {}) {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Exam-Cleaner-Token': token
    },
    body: JSON.stringify({
      version: 'exam-clean-v2',
      clientRequestId: 'test-request-1',
      image: {
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
        width: 1284,
        height: 1800
      },
      options: {
        removeAllAddedMarks: true,
        preservePrintedContent: true,
        preserveLayout: true,
        outputMimeType: 'image/png'
      },
      ...body
    })
  });
}

test('health endpoint reports readiness without exposing secrets', async () => {
  const response = await createHandler().fetch(
    new Request('https://proxy.example.workers.dev/health'),
    env()
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ready, true);
  assert.equal(payload.apiVersion, 'exam-clean-v2');
  assert.equal(JSON.stringify(payload).includes('test-gemini-key'), false);
  assert.equal(JSON.stringify(payload).includes('test-access-token'), false);
});

test('rejects requests from an unapproved origin', async () => {
  const response = await createHandler().fetch(cleanRequest({ origin: 'https://evil.example' }), env());
  assert.equal(response.status, 403);
});

test('rejects an invalid access token', async () => {
  const response = await createHandler().fetch(cleanRequest({ token: 'wrong-token' }), env());
  assert.equal(response.status, 401);
});

test('rejects requests when the Cloudflare rate limiter is exhausted', async () => {
  const response = await createHandler().fetch(
    cleanRequest(),
    env({ CLEAN_RATE_LIMITER: { async limit() { return { success: false }; } } })
  );
  assert.equal(response.status, 429);
});

test('returns the edited image from a successful Gemini response', async () => {
  let upstreamBody = null;
  const handler = createHandler({
    fetchImpl: async (_url, init) => {
      upstreamBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'cleaned-image-base64' } }] } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });

  const response = await handler.fetch(cleanRequest(), env());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.image.data, 'cleaned-image-base64');
  assert.equal(payload.image.mimeType, 'image/png');
  assert.equal(payload.meta.model, 'gemini-3.1-flash-image');
  assert.deepEqual(upstreamBody.generationConfig.responseModalities, ['IMAGE']);
  assert.equal(upstreamBody.contents[0].parts[1].inline_data.mime_type, 'image/png');
});
