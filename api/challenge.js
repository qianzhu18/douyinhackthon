const { json, methodNotAllowed } = require("./_lib/http");
const { authenticate } = require("./_lib/auth");
const { consumeQuota } = require("./_lib/supabase");

const BASE_URL = (process.env.STEPFUN_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, "");
const MODEL = process.env.STEPFUN_TEXT_MODEL || process.env.STEPFUN_VISION_MODEL || "step-3.5-flash";
const languages = { en: "英语", ja: "日语", ko: "韩语" };
const levels = { beginner: "A1-A2", intermediate: "B1-B2", advanced: "C1-C2" };

function clean(value, max) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function parse(content) {
  return JSON.parse(String(content || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

async function callModel(messages, maxTokens) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.STEPFUN_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, response_format: { type: "json_object" }, messages }),
    signal: AbortSignal.timeout(25000)
  });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = raw; }
  if (!response.ok) throw new Error(typeof payload === "string" ? payload : JSON.stringify(payload));
  return parse(payload?.choices?.[0]?.message?.content);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  const identity = await authenticate(req, res);
  if (!identity) return;
  if (!process.env.STEPFUN_API_KEY) return json(res, 503, { error: "服务端尚未配置 STEPFUN_API_KEY" });
  const { action, language, level } = req.body || {};
  if (!languages[language] || !levels[level]) return json(res, 400, { error: "不支持的目标语言或学习难度" });
  try {
    if (identity.user && !await consumeQuota(identity.user.id, "challenge", Number(process.env.DAILY_CHALLENGE_LIMIT || 30))) {
      return json(res, 429, { error: "今日口语任务额度已用完，请明天再来" });
    }
    if (action === "generate") {
      const summary = req.body?.summary || {};
      const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 5) : [];
      const allowed = new Set(items.map((item) => clean(item?.concept, 80)).filter(Boolean));
      if (!items.length) return json(res, 400, { error: "请先完成画面分析" });
      const result = await callModel([
        { role: "system", content: "你是沉浸式口语教练。只返回 JSON，不要 Markdown。" },
        { role: "user", content: [
          `目标语言：${languages[language]}；学习等级：${levels[level]}。`,
          `画面：${clean(summary.zh, 300)} / ${clean(summary.target, 300)}`,
          `学习点：${items.map((item) => `${clean(item.text, 80)}(${clean(item.concept, 80)})`).join(", ")}`,
          "设计一个一句话可完成的真实交流任务，必须有角色、对象和目的。",
          "返回 {role,taskZh,target,hintZh,concepts}；role/taskZh/hintZh 用简体中文，target 用目标语言，concepts 为上述 concept 的数组。"
        ].join("\n") }
      ], 450);
      if (!["role", "taskZh", "target", "hintZh"].every((key) => typeof result[key] === "string") || !Array.isArray(result.concepts)) {
        return json(res, 502, { error: "口语任务格式无效" });
      }
      result.concepts = result.concepts.map((value) => clean(value, 80)).filter((value) => allowed.has(value)).slice(0, 3);
      return json(res, 200, result);
    }
    if (action === "evaluate") {
      const transcript = clean(req.body?.transcript, 600);
      const challenge = req.body?.challenge || {};
      if (!transcript) return json(res, 400, { error: "回答不能为空" });
      const result = await callModel([
        { role: "system", content: "你是鼓励型口语教练，不因口音扣分。只返回 JSON。" },
        { role: "user", content: [
          `目标语言：${languages[language]}；等级：${levels[level]}。`,
          `角色：${clean(challenge.role, 120)}`,
          `任务：${clean(challenge.taskZh, 240)}`,
          `参考表达：${clean(challenge.target, 300)}`,
          `用户表达：${transcript}`,
          "返回 {score,label,feedback,improved}。score 为 0-100 整数；其余字段均为字符串。feedback 用简体中文，improved 用目标语言。"
        ].join("\n") }
      ], 400);
      if (!["label", "feedback", "improved"].every((key) => typeof result[key] === "string") || !Number.isFinite(Number(result.score))) {
        return json(res, 502, { error: "口语评价格式无效" });
      }
      result.score = Math.max(0, Math.min(100, Math.round(Number(result.score))));
      return json(res, 200, result);
    }
    return json(res, 400, { error: "不支持的操作" });
  } catch (error) {
    console.error("challenge error", error);
    return json(res, 502, { error: "口语服务暂时不可用，请稍后重试" });
  }
};
