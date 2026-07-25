const crypto = require("crypto");
const { readBearer } = require("./_lib/http");
const { userFromToken } = require("./_lib/auth");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const token = readBearer(req);
    if (!token) return json(res, 401, { error: "未登录" });
    try {
      const user = await userFromToken(token);
      return user ? json(res, 200, { user: { id: user.id, email: user.email } }) : json(res, 401, { error: "登录状态已失效" });
    } catch (error) {
      return json(res, 503, { error: error.message });
    }
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "仅支持 GET、POST 请求" });
  }
  if (process.env.ALLOW_LEGACY_ACCESS_CODE !== "true") return json(res, 410, { error: "体验码登录已关闭，请使用正式登录" });
  if (!process.env.APP_ACCESS_CODE) {
    return json(res, 503, { error: "服务端尚未配置 APP_ACCESS_CODE" });
  }
  if (!safeEqual(req.body?.code, process.env.APP_ACCESS_CODE)) {
    return json(res, 401, { error: "体验码不正确" });
  }
  return json(res, 200, { ok: true });
};
