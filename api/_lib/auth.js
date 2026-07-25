const crypto = require("crypto");
const { json, readBearer } = require("./http");

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function supabaseUrl() {
  return String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
}

async function userFromToken(token) {
  const url = supabaseUrl();
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("服务端尚未配置 Supabase Auth");
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

// The legacy code path exists only to let the current front end run during migration.
// Production should leave ALLOW_LEGACY_ACCESS_CODE unset.
async function authenticate(req, res) {
  const token = readBearer(req);
  if (token) {
    try {
      const user = await userFromToken(token);
      if (user) return { user, token, legacy: false };
    } catch (error) {
      return json(res, 503, { error: error.message });
    }
    return json(res, 401, { error: "登录状态已失效，请重新登录" });
  }

  const legacyAllowed = process.env.ALLOW_LEGACY_ACCESS_CODE === "true";
  if (legacyAllowed && process.env.APP_ACCESS_CODE
    && safeEqual(req.headers["x-access-code"], process.env.APP_ACCESS_CODE)) {
    return { user: null, token: "", legacy: true };
  }
  return json(res, 401, { error: "请先登录后再使用学习功能" });
}

module.exports = { authenticate, safeEqual, supabaseUrl, userFromToken };
