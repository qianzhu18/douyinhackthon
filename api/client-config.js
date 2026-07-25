const { json, methodNotAllowed } = require("./_lib/http");

// Supabase publishable keys are intentionally safe for browser use. This keeps
// the project URL/key out of the static demo bundle while never exposing a
// secret/service key.
module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return json(res, 503, { error: "学习账户服务尚未配置" });
  return json(res, 200, { supabaseUrl: url, publishableKey });
};
