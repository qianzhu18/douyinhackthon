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

function parseModelJson(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* try the next candidate */ }
  }
  return null;
}

function validResult(result) {
  return typeof result?.phonetic === "string"
    && result.phonetic.length <= 160
    && typeof result.context === "string"
    && result.context.length <= 500
    && typeof result.translation === "string"
    && result.translation.length <= 500
    && Array.isArray(result.tags)
    && result.tags.length === 3
    && result.tags.every((tag) => typeof tag === "string" && tag.length <= 100);
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
        // step-3.5-flash can spend several hundred tokens reasoning before it
        // emits JSON. A 300-token cap truncated the answer and leaked the raw
        // provider payload into the UI.
        max_tokens: 900,
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
              `学习点：${item.text.trim().slice(0, 160)}`,
              `中文释义：${item.meaning.trim().slice(0, 200)}`,
              `学习难度：${level}。${LEVELS[level]}`,
              `画面描述：${String(summary?.target || "").slice(0, 300)} / ${String(summary?.zh || "").slice(0, 300)}`,
              "请给出简洁发音标注、一个符合画面的自然例句、例句中文翻译和三个常用搭配。",
              "phonetic、context、tags 使用目标语言；translation 使用简体中文。"
            ].join("\n")
          }
        ]
      }),
      signal: AbortSignal.timeout(25000)
    });

    const responseText = await response.text();
    let payload;
    try { payload = JSON.parse(responseText); } catch { payload = responseText; }
    if (!response.ok) {
      console.error("stepfun detail upstream error", response.status);
      return json(res, response.status === 429 ? 429 : 502, {
        error: response.status === 429 ? "详情生成请求较多，请稍后再试" : "词条详情暂时没有生成出来"
      });
    }
    const outputText = payload?.choices?.[0]?.message?.content;
    const result = parseModelJson(outputText);
    if (!validResult(result)) {
      console.error("stepfun detail invalid result", payload?.choices?.[0]?.finish_reason || "unknown");
      return json(res, 502, { error: "词条详情暂时没有生成出来" });
    }
    return json(res, 200, result);
  } catch (error) {
    console.error("stepfun detail error", error);
    return json(res, 500, {
      error: error?.name === "TimeoutError" ? "详情生成超时，请稍后重试" : "详情生成暂时不可用"
    });
  }
};
