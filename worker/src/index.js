const API_VERSION = 'exam-clean-v2';
const PROMPT_VERSION = 'printed-preservation-openai-v1';
const DEFAULT_MODEL = 'gpt-image-1.5';
const MAX_BASE64_LENGTH = 18_000_000;
const MAX_OUTPUT_BASE64_LENGTH = 24_000_000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const PROMPT = `Perform a conservative document-restoration edit on the supplied scanned examination page.

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
  const image = payload?.data?.[0];
  if (!image?.b64_json) return null;
  return {
    mimeType: payload.output_format ? `image/${payload.output_format === 'jpg' ? 'jpeg' : payload.output_format}` : 'image/png',
    data: image.b64_json
  };
}

async function fetchOpenAI(fetchImpl, init, requestId) {
  let lastResponse;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl('https://api.openai.com/v1/images/edits', init);
    lastResponse = response;
    if (!RETRYABLE_STATUS.has(response.status) || attempt === 1) return response;
    console.warn('OpenAI temporary failure; retrying once', {
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
    provider: 'openai',
    apiVersion: API_VERSION,
    promptVersion: PROMPT_VERSION,
    model: env.OPENAI_MODEL || DEFAULT_MODEL,
    ready: Boolean(env.OPENAI_API_KEY && env.ACCESS_TOKEN),
    authRequired: true,
    maxInputBase64Bytes: MAX_BASE64_LENGTH
  };
}

function openAIErrorMessage(status) {
  if (status === 401 || status === 403) return 'OpenAI API Key 無效或沒有模型權限';
  if (status === 429) return 'OpenAI 服務目前繁忙、已達速率限制或額度不足';
  if (status === 400) return 'OpenAI 無法接受此圖片或編輯設定';
  return 'OpenAI 圖片編輯服務處理失敗，請稍後再試';
}

export function createHandler({ fetchImpl = fetch } = {}) {
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      const origin = isAllowedOrigin(request, env);

      if (request.method === 'GET' && url.pathname === '/health') {
        return json(healthPayload(env), 200, origin || '*');
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
      if (!env.OPENAI_API_KEY) return json({ error: 'Proxy 尚未設定 OpenAI API Key' }, 503, origin);
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
      const model = env.OPENAI_MODEL || DEFAULT_MODEL;
      const tokenHash = await sha256Hex(request.headers.get('X-Exam-Cleaner-Token') || origin);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000);
      const startedAt = Date.now();
      const inputDataUrl = `data:${mimeType};base64,${data}`;

      try {
        const upstream = await fetchOpenAI(fetchImpl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            'X-Client-Request-Id': requestId
          },
          body: JSON.stringify({
            model,
            images: [{ image_url: inputDataUrl }],
            prompt: PROMPT,
            input_fidelity: 'high',
            quality: 'high',
            size: 'auto',
            output_format: 'png',
            background: 'opaque',
            moderation: 'auto',
            n: 1,
            user: `exam-cleaner-${tokenHash.slice(0, 24)}`
          })
        }, requestId);

        const providerRequestId = upstream.headers.get('x-request-id') || null;
        const payload = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          console.error('OpenAI request failed', {
            requestId,
            providerRequestId,
            status: upstream.status,
            durationMs: Date.now() - startedAt,
            providerCode: payload?.error?.code || null,
            providerType: payload?.error?.type || null
          });
          const status = upstream.status === 429 ? 429 : 502;
          return json({ error: openAIErrorMessage(upstream.status), requestId }, status, origin);
        }

        const image = extractOutputImage(payload);
        if (!image || image.data.length > MAX_OUTPUT_BASE64_LENGTH) {
          console.error('OpenAI returned no usable image', {
            requestId,
            providerRequestId,
            durationMs: Date.now() - startedAt
          });
          return json({ error: 'OpenAI 沒有回傳可用圖片', requestId }, 502, origin);
        }

        return json({
          requestId,
          image,
          warnings: [],
          meta: {
            provider: 'openai',
            promptVersion: PROMPT_VERSION,
            model,
            durationMs: Date.now() - startedAt,
            providerRequestId
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
          error: timeoutError ? 'OpenAI 圖片處理逾時' : 'Proxy 暫時無法連線',
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
