const { json, methodNotAllowed } = require("./_lib/http");

async function databaseReady() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const response = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5000)
  });
  return response.ok;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const required = ["STEPFUN_API_KEY"];
  if (process.env.ALLOW_LEGACY_ACCESS_CODE !== "true") {
    required.push("SUPABASE_URL");
    if (!(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)) required.push("SUPABASE_PUBLISHABLE_KEY");
    if (!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) required.push("SUPABASE_SECRET_KEY");
  }
  const missing = required.filter((name) => !process.env[name]);
  const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
  const database = hasSupabaseConfig ? await databaseReady().catch(() => false) : null;
  const ready = missing.length === 0 && (database !== false);
  return json(res, ready ? 200 : 503, {
    ok: ready,
    service: "frame-language-api",
    dependencies: { database: database === true ? "ready" : database === false ? "migration_required" : "not_configured" },
    missing: process.env.HEALTHCHECK_DEBUG === "true" ? missing : undefined
  });
};
