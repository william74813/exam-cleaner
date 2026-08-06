import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../worker/src/index.js';

const ORIGIN = 'https://william74813.github.io';
const ENDPOINT = 'https://proxy.example.workers.dev/api/clean';

function env(overrides = {}) {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    OPENAI_MODEL: 'gpt-image-1.5',
    OPENAI_API_KEY: 'test-openai-key',
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

test('health endpoint reports OpenAI readiness without exposing secrets', async () => {
  const response = await createHandler().fetch(
    new Request('https://proxy.example.workers.dev/health'),
    env()
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ready, true);
  assert.equal(payload.provider, 'openai');
  assert.equal(payload.model, 'gpt-image-1.5');
  assert.equal(payload.apiVersion, 'exam-clean-v2');
  assert.equal(JSON.stringify(payload).includes('test-openai-key'), false);
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

test('returns the edited image from a successful OpenAI response', async () => {
  let upstreamUrl = null;
  let upstreamHeaders = null;
  let upstreamBody = null;
  const handler = createHandler({
    fetchImpl: async (url, init) => {
      upstreamUrl = url;
      upstreamHeaders = init.headers;
      upstreamBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        output_format: 'png',
        data: [{ b64_json: 'cleaned-image-base64' }]
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'provider-request-1'
        }
      });
    }
  });

  const response = await handler.fetch(cleanRequest(), env());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.image.data, 'cleaned-image-base64');
  assert.equal(payload.image.mimeType, 'image/png');
  assert.equal(payload.meta.provider, 'openai');
  assert.equal(payload.meta.model, 'gpt-image-1.5');
  assert.equal(payload.meta.providerRequestId, 'provider-request-1');
  assert.equal(upstreamUrl, 'https://api.openai.com/v1/images/edits');
  assert.equal(upstreamHeaders.Authorization, 'Bearer test-openai-key');
  assert.equal(upstreamBody.model, 'gpt-image-1.5');
  assert.equal(upstreamBody.input_fidelity, 'high');
  assert.equal(upstreamBody.quality, 'high');
  assert.equal(upstreamBody.output_format, 'png');
  assert.equal(upstreamBody.images.length, 1);
  assert.ok(upstreamBody.images[0].image_url.startsWith('data:image/png;base64,'));
  assert.equal(upstreamBody.prompt.includes('PRINTED CONTENT IS IMMUTABLE'), true);
});

test('maps an invalid OpenAI key to a user-safe error', async () => {
  const handler = createHandler({
    fetchImpl: async () => new Response(JSON.stringify({
      error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'secret provider detail' }
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  });

  const response = await handler.fetch(cleanRequest(), env());
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, 'OpenAI API Key 無效或沒有模型權限');
  assert.equal(JSON.stringify(payload).includes('secret provider detail'), false);
});
