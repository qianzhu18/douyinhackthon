const { json, methodNotAllowed } = require("./_lib/http");
const { authenticate } = require("./_lib/auth");
const { request } = require("./_lib/supabase");

const languages = new Set(["en", "ja", "ko"]);
const levels = new Set(["beginner", "intermediate", "advanced"]);

module.exports = async function handler(req, res) {
  if (!["GET", "PUT"].includes(req.method)) return methodNotAllowed(res, ["GET", "PUT"]);
  const identity = await authenticate(req, res);
  if (!identity || identity.legacy) return identity || undefined;
  const id = identity.user.id;
  try {
    if (req.method === "GET") {
      const [settings] = await request(`/rest/v1/user_settings?user_id=eq.${encodeURIComponent(id)}&select=target_language,level,updated_at`);
      return json(res, 200, { settings: settings || { target_language: "en", level: "beginner" } });
    }
    const { target_language, level } = req.body || {};
    if (!languages.has(target_language) || !levels.has(level)) return json(res, 400, { error: "学习语言或难度无效" });
    const [settings] = await request("/rest/v1/user_settings?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ user_id: id, target_language, level, updated_at: new Date().toISOString() })
    });
    return json(res, 200, { settings });
  } catch (error) {
    return json(res, 500, { error: "保存学习设置失败" });
  }
};
