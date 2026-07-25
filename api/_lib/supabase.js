const { supabaseUrl } = require("./auth");

function config() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("服务端尚未配置 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
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

async function consumeQuota(userId, bucket, limit) {
  if (!userId) return true;
  const payload = await request("/rest/v1/rpc/consume_ai_quota", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId, p_bucket: bucket, p_limit: limit })
  });
  return payload === true;
}

module.exports = { request, consumeQuota };
