const crypto = require("crypto");
const { authenticate } = require("./_lib/auth");
const { consumeQuota } = require("./_lib/supabase");

const MODEL = process.env.STEPFUN_TEXT_MODEL
  || process.env.STEPFUN_VISION_MODEL
  || "step-3.5-flash";
const BASE_URL = (process.env.STEPFUN_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, "");
const LANGUAGES = {
  en: { name: "英语", locale: "English" },
  ja: { name: "日语", locale: "Japanese" },
  ko: { name: "韩语", locale: "Korean" }
};
const LEVELS = {
  beginner: "使用 A1-A2 的高频词汇和简短句型，例句控制在 6-10 个词左右。",
  intermediate: "使用 B1-B2 的自然搭配和完整场景句，体现常用语法变化。",
  advanced: "使用 C1-C2 的精确、地道表达和较丰富句式，但保持符合当前画面。"
};
const detailSchema = {
  type: "object",
  additionalProperties: false,
  required: ["phonetic", "context", "translation", "tags"],
  properties: {
    phonetic: { type: "string" },
    context: { type: "string" },
    translation: { type: "string" },
    tags: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string" }
    }
  }
};

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

function rawError(payload, fallback) {
  if (typeof payload === "string" && payload) return payload;
  try { return payload ? JSON.stringify(payload) : fallback; } catch { return fallback; }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "仅支持 POST 请求" });
  const identity = await authenticate(req, res);
  if (!identity) return;
  if (!process.env.STEPFUN_API_KEY) return json(res, 503, { error: "服务端尚未配置 STEPFUN_API_KEY" });

  const { language, level, item, summary } = req.body || {};
  if (!LANGUAGES[language]) return json(res, 400, { error: "不支持的目标语言" });
  if (!LEVELS[level]) return json(res, 400, { error: "不支持的学习难度" });
  if (!item || typeof item.text !== "string" || typeof item.meaning !== "string") {
    return json(res, 400, { error: "缺少学习点信息" });
  }

  try {
    if (identity.user && !await consumeQuota(identity.user.id, "word_detail", Number(process.env.DAILY_DETAIL_LIMIT || 100))) {
      return json(res, 429, { error: "今日词汇详情次数已用完，请明天再来" });
    }
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.STEPFUN_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              `你是语言学习助手。目标语言是${LANGUAGES[language].name}。`,
              "只返回 JSON 对象，不要解释或 Markdown。",
              `严格遵循这个 JSON Schema：${JSON.stringify(detailSchema)}`
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `学习点：${item.text}`,
              `中文释义：${item.meaning}`,
              `学习难度：${level}。${LEVELS[level]}`,
              `画面描述：${summary?.target || ""} / ${summary?.zh || ""}`,
              "请给出简洁发音标注、一个符合画面的自然例句、例句中文翻译和三个常用搭配。",
              "phonetic、context、tags 使用目标语言；translation 使用简体中文。"
            ].join("\n")
          }
        ]
      }),
      signal: AbortSignal.timeout(20000)
    });

    const responseText = await response.text();
    let payload;
    try { payload = JSON.parse(responseText); } catch { payload = responseText; }
    if (!response.ok) return json(res, response.status, { error: rawError(payload, "详情生成失败") });
    const outputText = payload?.choices?.[0]?.message?.content;
    if (!outputText) return json(res, 502, { error: rawError(payload, "模型未返回详情") });
    let result;
    try { result = JSON.parse(outputText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
    catch { return json(res, 502, { error: outputText }); }
    const valid = typeof result.phonetic === "string"
      && typeof result.context === "string"
      && typeof result.translation === "string"
      && Array.isArray(result.tags)
      && result.tags.length === 3;
    return valid ? json(res, 200, result) : json(res, 502, { error: outputText });
  } catch (error) {
    console.error("stepfun detail error", error);
    return json(res, 500, { error: error?.message || String(error) });
  }
};
