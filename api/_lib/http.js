function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  return json(res, 405, { error: `仅支持 ${methods.join("、")} 请求` });
}

function readBearer(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

module.exports = { json, methodNotAllowed, readBearer };
