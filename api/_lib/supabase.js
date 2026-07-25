const { supabaseUrl } = require("./auth");

function config() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("服务端尚未配置 SUPABASE_URL 或 SUPABASE_SECRET_KEY");
  return { url, key };
}

async function request(path, options = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) throw new Error(typeof payload === "string" ? payload : JSON.stringify(payload));
  return payload;
}

function storagePath(path) {
  return String(path || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function absoluteStorageUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const storagePathname = normalized.startsWith("/storage/v1/")
    ? normalized
    : `/storage/v1${normalized}`;
  return `${supabaseUrl()}${storagePathname}`;
}

async function uploadPrivateFrame(path, mimeType, body) {
  return request(`/storage/v1/object/frame-cards/${storagePath(path)}`, {
    method: "PUT",
    headers: { "Content-Type": mimeType, "x-upsert": "true" },
    body
  });
}

async function signedFrameUrl(path, expiresIn = 3600) {
  if (!path) return null;
  const payload = await request(`/storage/v1/object/sign/frame-cards/${storagePath(path)}`, {
    method: "POST",
    body: JSON.stringify({ expiresIn })
  });
  const signedPath = payload?.signedURL || payload?.signedUrl;
  if (!signedPath) return null;
  return absoluteStorageUrl(signedPath);
}

async function recordEvent(userId, eventType, payload = {}) {
  if (!userId) return;
  await request("/rest/v1/learning_events", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, event_type: eventType, payload })
  });
}

async function consumeQuota(userId, bucket, limit) {
  if (!userId) return true;
  const payload = await request("/rest/v1/rpc/consume_ai_quota", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId, p_bucket: bucket, p_limit: limit })
  });
  return payload === true;
}

module.exports = { request, consumeQuota, uploadPrivateFrame, signedFrameUrl, recordEvent, absoluteStorageUrl };
