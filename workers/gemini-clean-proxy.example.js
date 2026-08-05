// Cloudflare Worker example for Exam Cleaner v2.2.
// Required secrets / variables:
//   GEMINI_API_KEY  - secret
//   ALLOWED_ORIGIN  - e.g. https://william74813.github.io
// Optional:
//   GEMINI_MODEL    - defaults to gemini-3.1-flash-image
//
// This is a deployment template, not a production-complete rate limiter.

const PROMPT = `Edit the provided scanned examination page.

Primary rule: preserve every original printed element exactly, including all questions, instructions, Chinese and English text, numbers, punctuation, page numbers, mathematical formulas, operators, units, answer lines, tables, diagrams, illustrations, images, graphics and QR codes.

Remove every mark added after printing, including handwritten answers, pencil writing, pen writing, erasures, teacher corrections, scores, checkmarks, crosses, circles, underlines and annotations. Do not distinguish between teacher and student handwriting: remove all added marks.

Do not solve questions, add answers, rewrite or translate text, change wording, rearrange layout, crop the page, alter pagination, remove printed content, invent content or stylize the document. Fill removed areas only with the surrounding original paper background. Keep the original orientation and aspect ratio. Return one clean printable page image only.`;

const MAX_BASE64_LENGTH = 18_000_000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
      'Cache-Control': 'no-store'
    }
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = (env.ALLOWED_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
  return configured.includes(origin) ? origin : '';
}

function extractOutputImage(payload) {
  if (payload?.output_image?.data) {
    return {
      mimeType: payload.output_image.mime_type || 'image/png',
      data: payload.output_image.data
    };
  }

  for (const step of payload?.steps || []) {
    if (step?.type !== 'model_output') continue;
    for (const item of step.content || []) {
      if (item?.type === 'image' && item?.data) {
        return { mimeType: item.mime_type || 'image/png', data: item.data };
      }
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return json({}, 204, origin);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin || 'null');
    }

    if (!origin) {
      return json({ error: 'Origin not allowed' }, 403, 'null');
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Proxy 尚未設定 Gemini API Key' }, 500, origin);
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > 25_000_000) {
      return json({ error: '圖片資料過大' }, 413, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'JSON 格式錯誤' }, 400, origin);
    }

    if (body?.version !== 'exam-clean-v1') {
      return json({ error: '不支援的請求版本' }, 400, origin);
    }

    const mimeType = body?.image?.mimeType;
    const data = body?.image?.data;
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return json({ error: '只接受 JPEG、PNG 或 WebP' }, 415, origin);
    }
    if (typeof data !== 'string' || !data.length || data.length > MAX_BASE64_LENGTH) {
      return json({ error: '圖片資料缺失或超過大小限制' }, 413, origin);
    }

    const requestId = crypto.randomUUID();
    const model = env.GEMINI_MODEL || 'gemini-3.1-flash-image';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          model,
          input: [
            { type: 'text', text: PROMPT },
            { type: 'image', mime_type: mimeType, data }
          ],
          response_format: {
            type: 'image',
            mime_type: body?.options?.outputMimeType || 'image/png',
            image_size: '2K'
          }
        })
      });

      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        console.error('Gemini request failed', {
          requestId,
          status: upstream.status,
          message: payload?.error?.message || 'unknown'
        });
        return json({ error: 'AI 服務處理失敗，請稍後再試', requestId }, 502, origin);
      }

      const image = extractOutputImage(payload);
      if (!image) {
        console.error('Gemini returned no image', { requestId });
        return json({ error: 'AI 沒有回傳圖片', requestId }, 502, origin);
      }

      return json({ requestId, image, warnings: [] }, 200, origin);
    } catch (error) {
      const timeoutError = error?.name === 'AbortError';
      console.error('Proxy error', { requestId, timeoutError, message: error?.message });
      return json({ error: timeoutError ? 'AI 處理逾時' : 'Proxy 暫時無法連線', requestId }, 504, origin);
    } finally {
      clearTimeout(timeout);
    }
  }
};
