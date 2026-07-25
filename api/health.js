const { json, methodNotAllowed } = require("./_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const required = ["STEPFUN_API_KEY"];
  if (process.env.ALLOW_LEGACY_ACCESS_CODE !== "true") {
    required.push("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  }
  const missing = required.filter((name) => !process.env[name]);
  return json(res, missing.length ? 503 : 200, {
    ok: missing.length === 0,
    service: "frame-language-api",
    missing: process.env.HEALTHCHECK_DEBUG === "true" ? missing : undefined
  });
};
