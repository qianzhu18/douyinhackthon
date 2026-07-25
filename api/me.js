const { json, methodNotAllowed } = require("./_lib/http");
const { authenticate } = require("./_lib/auth");
const { request } = require("./_lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const identity = await authenticate(req, res);
  if (!identity || identity.legacy) return identity || undefined;
  try {
    const id = encodeURIComponent(identity.user.id);
    const [profile] = await request(`/rest/v1/profiles?id=eq.${id}&select=id,display_name,created_at`);
    const [settings] = await request(`/rest/v1/user_settings?user_id=eq.${id}&select=target_language,level,updated_at`);
    return json(res, 200, { user: { id: identity.user.id, email: identity.user.email, profile: profile || null }, settings: settings || null });
  } catch (error) {
    return json(res, 500, { error: "读取用户资料失败" });
  }
};
