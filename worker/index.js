/**
 * Cloudflare Worker — Labirinto de Fármacos
 *
 * Rotas:
 *   POST /api/quiz-result         — guarda resultado de um quiz na D1
 *   POST /api/page-view           — regista visualização de uma página de doença
 *   GET  /api/stats               — estatísticas agregadas de todas as doenças
 *   GET  /api/stats/:disease      — estatísticas de uma doença específica
 *   GET  /images/:filename        — serve imagem do bucket R2 (labirinto-images)
 *
 * Bindings esperados (definidos em wrangler.toml):
 *   - DB     → D1 Database
 *   - IMAGES → R2 Bucket (labirinto-images)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  ...CORS_HEADERS,
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function errorResponse(status, message) {
  return json({ error: message }, { status });
}

/* ─────────── R2 helpers ──────────────────────────────── */

const ALLOWED_IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico)$/i;
const CONTENT_TYPE_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

async function serveImage(filename, env, request) {
  if (!filename || filename.includes('/') || filename.includes('..')) {
    return errorResponse(400, 'Invalid filename');
  }
  if (!ALLOWED_IMAGE_EXT.test(filename)) {
    return errorResponse(400, 'Unsupported image type');
  }

  // 1. Tentar primeiro o bucket R2 (preferido — controlo total de cache, ETag, etc.)
  const object = env.IMAGES ? await env.IMAGES.get(filename) : null;

  if (!object) {
    // 2. Fallback: tentar como asset estático (pasta /images/ do repo).
    //    NOTA: o assets binding tem not_found_handling = "single-page-application",
    //    que serve index.html (HTML 200 OK) para paths inexistentes — por isso
    //    precisamos de validar o Content-Type da resposta para evitar servir
    //    HTML disfarçado de imagem.
    if (env.ASSETS && request) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        const ct = (assetResponse.headers.get('Content-Type') || '').toLowerCase();
        if (assetResponse.ok && ct.startsWith('image/')) {
          // Acrescentar cache headers + CORS sem alterar o body
          const headers = new Headers(assetResponse.headers);
          headers.set('Cache-Control', 'public, max-age=31536000, immutable');
          for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
          return new Response(assetResponse.body, {
            status: assetResponse.status,
            headers,
          });
        }
      } catch (e) {
        // ignora; cai para 404
      }
    }
    return errorResponse(404, 'Image not found');
  }

  const ext = filename.split('.').pop().toLowerCase();
  const contentType = object.httpMetadata?.contentType
    || CONTENT_TYPE_BY_EXT[ext]
    || 'application/octet-stream';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': object.httpEtag,
      ...CORS_HEADERS,
    },
  });
}

/* ─────────── D1 helpers ──────────────────────────────── */

async function bumpDiseaseStats(env, disease, column) {
  if (!['views', 'quiz_completions'].includes(column)) return;
  await env.DB.prepare(
    `INSERT INTO disease_stats (disease, ${column}, updated_at)
     VALUES (?1, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(disease) DO UPDATE SET
       ${column} = ${column} + 1,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(disease).run();
}

async function recordQuizResult(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON body');
  }
  const disease = (payload.disease || '').toString().trim();
  const result = (payload.result || '').toString().trim();
  if (!disease || !result) {
    return errorResponse(400, 'Fields "disease" and "result" are required');
  }
  if (disease.length > 64 || result.length > 512) {
    return errorResponse(400, 'Field too long');
  }

  await env.DB.prepare(
    'INSERT INTO quiz_results (disease, result) VALUES (?1, ?2)'
  ).bind(disease, result).run();

  await bumpDiseaseStats(env, disease, 'quiz_completions');

  return json({ ok: true });
}

async function recordPageView(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON body');
  }
  const page = (payload.page || '').toString().trim();
  if (!page) return errorResponse(400, 'Field "page" is required');
  if (page.length > 64) return errorResponse(400, 'Field too long');

  await env.DB.prepare(
    'INSERT INTO page_views (page) VALUES (?1)'
  ).bind(page).run();

  await bumpDiseaseStats(env, page, 'views');

  return json({ ok: true });
}

async function getStatsAll(env) {
  const stats = await env.DB.prepare(
    `SELECT disease, views, quiz_completions, updated_at
     FROM disease_stats
     ORDER BY views DESC, disease ASC`
  ).all();

  const totals = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM page_views) AS total_views,
       (SELECT COUNT(*) FROM quiz_results) AS total_quizzes`
  ).first();

  return json({
    diseases: stats.results || [],
    totals: totals || { total_views: 0, total_quizzes: 0 },
  });
}

async function getStatsForDisease(disease, env) {
  if (!disease) return errorResponse(400, 'Missing disease');

  const summary = await env.DB.prepare(
    `SELECT disease, views, quiz_completions, updated_at
     FROM disease_stats WHERE disease = ?1`
  ).bind(disease).first();

  const recent = await env.DB.prepare(
    `SELECT result, timestamp
     FROM quiz_results
     WHERE disease = ?1
     ORDER BY timestamp DESC
     LIMIT 20`
  ).bind(disease).all();

  if (!summary && (!recent.results || recent.results.length === 0)) {
    return json({
      disease,
      views: 0,
      quiz_completions: 0,
      recent_results: [],
    }, { status: 200 });
  }

  return json({
    disease,
    views: summary?.views || 0,
    quiz_completions: summary?.quiz_completions || 0,
    updated_at: summary?.updated_at || null,
    recent_results: recent.results || [],
  });
}

/* ─────────── Router ──────────────────────────────────── */

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/api/quiz-result' && request.method === 'POST') {
        return await recordQuizResult(request, env);
      }
      if (path === '/api/page-view' && request.method === 'POST') {
        return await recordPageView(request, env);
      }
      if (path === '/api/stats' && request.method === 'GET') {
        return await getStatsAll(env);
      }

      const statsMatch = path.match(/^\/api\/stats\/([A-Za-z0-9_-]{1,64})$/);
      if (statsMatch && request.method === 'GET') {
        return await getStatsForDisease(statsMatch[1], env);
      }

      const imgMatch = path.match(/^\/images\/([^/]+)$/);
      if (imgMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        return await serveImage(decodeURIComponent(imgMatch[1]), env, request);
      }

      return errorResponse(404, 'Not found');
    } catch (err) {
      console.error('Worker error', err && err.stack || err);
      return errorResponse(500, 'Internal error');
    }
  },
};
