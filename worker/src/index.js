const API_VERSION = 'exam-clean-v2';
const PROMPT_VERSION = 'printed-preservation-v3';
const DEFAULT_MODEL = 'gemini-3.1-flash-image';
const MAX_BASE64_LENGTH = 18_000_000;
const MAX_OUTPUT_BASE64_LENGTH = 24_000_000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const PROMPT = `Edit the provided scanned examination page as a conservative document-restoration task.

PRINTED CONTENT IS IMMUTABLE:
Preserve every original printed element exactly, including every question, instruction, Chinese and English character, number, punctuation mark, page number, mathematical formula, operator, unit, answer line, table border, diagram, illustration, photograph, graphic, logo, barcode and QR code. Preserve the original position, scale, spacing, orientation, aspect ratio and page layout.

REMOVE ALL POST-PRINT MARKS:
Remove every mark added after printing, including handwritten answers, pencil or pen writing, erasures, teacher corrections, scores, checkmarks, crosses, circles, handwritten underlines, highlighting and annotations. Do not distinguish between teacher and student handwriting: remove all added marks.

PROHIBITED CHANGES:
Do not solve any question, add an answer, rewrite or translate text, correct spelling, change wording, redraw printed content, rearrange layout, crop the page, change pagination, remove printed content, invent content or stylize the document. Fill removed areas only with the surrounding original paper background. Return one clean printable page image only.`;

function configuredOrigins(env) {
  return String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function requestOrigin(request) {
  return request.headers.get('Origin') || '';
}

function isAllowedOrigin(request, env) {
  const origin = requestOrigin(request);
  return origin && configuredOrigins(env).includes(origin) ? origin : '';
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Exam-Cleaner-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };
}

function json(body, status = 200, origin = '*', extraHeaders = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
      ...extraHeaders
    }
  });
}

function safeRequestId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(value)
    ? value
    : crypto.randomUUID();
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function secureEquals(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const [a, b] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function validateAccessToken(request, env) {
  if (!env.ACCESS_TOKEN) return false;
  return secureEquals(request.headers.get('X-Exam-Cleaner-Token') || '', env.ACCESS_TOKEN);
}

async function enforceRateLimit(request, env, origin) {
  if (!env.CLEAN_RATE_LIMITER?.limit) return { allowed: true };
  const token = request.headers.get('X-Exam-Cleaner-Token') || '';
  const actor = token ? `token:${await sha256Hex(token)}` : `origin:${origin}`;
  const result = await env.CLEAN_RATE_LIMITER.limit({ key: actor });
  return { allowed: Boolean(result?.success) };
}

function extractOutputImage(payload) {
  for (const candidate of payload?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (part?.thought) continue;
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data) {
        return {
          mimeType: inline.mimeType || inline.mime_type || 'image/png',
          data: inline.data
        };
      }
    }
  }
  return null;
}

async function fetchGemini(fetchImpl, url, init, requestId) {
  let lastResponse;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl(url, init);
    lastResponse = response;
    if (!RETRYABLE_STATUS.has(response.status) || attempt === 1) return response;
    console.warn('Gemini temporary failure; retrying once', {
      requestId,
      status: response.status,
      attempt: attempt + 1
    });
    await new Promise(resolve => setTimeout(resolve, 700 + Math.floor(Math.random() * 500)));
  }
  return lastResponse;
}

function healthPayload(env) {
  return {
    service: 'exam-cleaner-proxy',
    apiVersion: API_VERSION,
    promptVersion: PROMPT_VERSION,
    model: env.GEMINI_MODEL || DEFAULT_MODEL,
    ready: Boolean(env.GEMINI_API_KEY && env.ACCESS_TOKEN),
    authRequired: true,
    maxInputBase64Bytes: MAX_BASE64_LENGTH
  };
}

export function createHandler({ fetchImpl = fetch } = {}) {
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      const origin = isAllowedOrigin(request, env);

      if (request.method === 'GET' && url.pathname === '/health') {
        const healthOrigin = origin || '*';
        return json(healthPayload(env), 200, healthOrigin);
      }

      if (url.pathname !== '/api/clean') {
        return json({ error: 'Not found' }, 404, origin || '*');
      }

      if (request.method === 'OPTIONS') {
        if (!origin) return json({ error: 'Origin not allowed' }, 403, 'null');
        return json(null, 204, origin);
      }

      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, origin || 'null');
      }
      if (!origin) return json({ error: 'Origin not allowed' }, 403, 'null');
      if (!env.GEMINI_API_KEY) return json({ error: 'Proxy 尚未設定 Gemini API Key' }, 503, origin);
      if (!env.ACCESS_TOKEN) return json({ error: 'Proxy 尚未設定存取權杖' }, 503, origin);
      if (!(await validateAccessToken(request, env))) return json({ error: '存取權杖錯誤' }, 401, origin);

      const rateLimit = await enforceRateLimit(request, env, origin);
      if (!rateLimit.allowed) return json({ error: '請求過於頻繁，請稍後再試' }, 429, origin);

      const contentLength = Number(request.headers.get('Content-Length') || 0);
      if (contentLength > 25_000_000) return json({ error: '圖片資料過大' }, 413, origin);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'JSON 格式錯誤' }, 400, origin);
      }

      if (body?.version !== API_VERSION) {
        return json({ error: '不支援的請求版本' }, 400, origin);
      }
      if (
        body?.options?.removeAllAddedMarks !== true ||
        body?.options?.preservePrintedContent !== true ||
        body?.options?.preserveLayout !== true
      ) {
        return json({ error: '必要的印刷內容保護選項未啟用' }, 400, origin);
      }

      const mimeType = body?.image?.mimeType;
      const data = body?.image?.data;
      const width = Number(body?.image?.width || 0);
      const height = Number(body?.image?.height || 0);

      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return json({ error: '只接受 JPEG、PNG 或 WebP' }, 415, origin);
      }
      if (typeof data !== 'string' || !data.length || data.length > MAX_BASE64_LENGTH) {
        return json({ error: '圖片資料缺失或超過大小限制' }, 413, origin);
      }
      if (width && height && (width < 200 || height < 200 || width > 8000 || height > 8000)) {
        return json({ error: '圖片尺寸超出允許範圍' }, 400, origin);
      }

      const requestId = safeRequestId(body?.clientRequestId);
      const model = env.GEMINI_MODEL || DEFAULT_MODEL;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 125_000);
      const startedAt = Date.now();

      try {
        const upstreamUrl = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`;
        const upstream = await fetchGemini(fetchImpl, upstreamUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: mimeType, data } }
              ]
            }],
            generationConfig: {
              responseModalities: ['IMAGE']
            }
          })
        }, requestId);

        const payload = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          console.error('Gemini request failed', {
            requestId,
            status: upstream.status,
            durationMs: Date.now() - startedAt,
            providerMessage: payload?.error?.message || 'unknown'
          });
          const status = upstream.status === 429 ? 429 : 502;
          return json({
            error: upstream.status === 429
              ? 'AI 服務目前繁忙或已達配額，請稍後再試'
              : 'AI 服務處理失敗，請稍後再試',
            requestId
          }, status, origin);
        }

        const image = extractOutputImage(payload);
        if (!image || image.data.length > MAX_OUTPUT_BASE64_LENGTH) {
          console.error('Gemini returned no usable image', {
            requestId,
            durationMs: Date.now() - startedAt
          });
          return json({ error: 'AI 沒有回傳可用圖片', requestId }, 502, origin);
        }

        return json({
          requestId,
          image,
          warnings: [],
          meta: {
            promptVersion: PROMPT_VERSION,
            model,
            durationMs: Date.now() - startedAt
          }
        }, 200, origin);
      } catch (error) {
        const timeoutError = error?.name === 'AbortError';
        console.error('Proxy error', {
          requestId,
          timeoutError,
          durationMs: Date.now() - startedAt,
          message: error?.message
        });
        return json({
          error: timeoutError ? 'AI 處理逾時' : 'Proxy 暫時無法連線',
          requestId
        }, timeoutError ? 504 : 502, origin);
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export { API_VERSION, PROMPT_VERSION, DEFAULT_MODEL };
export default createHandler();
