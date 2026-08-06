import proxyHandler from './index.js';

function configuredOrigins(env) {
  return String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function corsHeaders(origin) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Exam-Cleaner-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
}

function response(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin)
  });
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

async function secureEquals(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/auth-check') {
      return proxyHandler.fetch(request, env, ctx);
    }

    const origin = request.headers.get('Origin') || '';
    if (!configuredOrigins(env).includes(origin)) {
      return response({ error: 'Origin not allowed' }, 403, 'null');
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET') {
      return response({ error: 'Method not allowed' }, 405, origin);
    }
    if (!env.OPENAI_API_KEY || !env.ACCESS_TOKEN) {
      return response({
        authorized: false,
        ready: false,
        provider: 'openai',
        error: 'Proxy Secrets 尚未設定完成'
      }, 503, origin);
    }

    const supplied = request.headers.get('X-Exam-Cleaner-Token') || '';
    if (!(await secureEquals(supplied, env.ACCESS_TOKEN))) {
      return response({ authorized: false, ready: true, provider: 'openai', error: '存取權杖錯誤' }, 401, origin);
    }

    return response({
      authorized: true,
      ready: true,
      provider: 'openai',
      apiVersion: 'exam-clean-v2',
      model: env.OPENAI_MODEL || 'gpt-image-1.5'
    }, 200, origin);
  }
};
