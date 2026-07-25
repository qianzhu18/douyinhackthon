const crypto = require("crypto");
const { authenticate } = require("./_lib/auth");
const { consumeQuota, recordEvent } = require("./_lib/supabase");

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MODEL = process.env.STEPFUN_VISION_MODEL || "step-1o-turbo-vision";
const BASE_URL = (process.env.STEPFUN_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, "");
const LANGUAGES = {
  en: { name: "英语", locale: "English" },
  ja: { name: "日语", locale: "Japanese" },
  ko: { name: "韩语", locale: "Korean" }
};
const LEVELS = {
  beginner: {
    label: "CEFR A1-A2",
    instruction: "优先高频、具体、容易指向的物品、人物和基础动作。避免专业术语、习语和抽象表达。"
  },
  intermediate: {
    label: "CEFR B1-B2",
    instruction: "减少过于基础的物品名，优先动作、常用搭配、短语动词和具体场景表达。"
  },
  advanced: {
    label: "CEFR C1-C2",
    instruction: "优先精确术语、地道搭配、语境表达和细微动作描述；画面没有自然高阶表达时不要生造晦涩词。"
  }
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "items"],
  properties: {
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["target", "zh"],
      properties: {
        target: { type: "string" },
        zh: { type: "string" }
      }
    },
    items: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "concept", "kind", "cefr", "x", "y", "text", "meaning"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
          concept: { type: "string", pattern: "^[a-z0-9-]{1,60}$" },
          kind: { type: "string", enum: ["noun", "verb", "person", "phrase"] },
          cefr: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"] },
          x: { type: "number", minimum: 8, maximum: 92 },
          y: { type: "number", minimum: 10, maximum: 88 },
          text: { type: "string" },
          meaning: { type: "string" },
        }
      }
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

function isAuthorized(req) {
  return process.env.APP_ACCESS_CODE
    && safeEqual(req.headers["x-access-code"], process.env.APP_ACCESS_CODE);
}

function isValidResult(result) {
  const validSummary = result?.summary
    && typeof result.summary.target === "string"
    && typeof result.summary.zh === "string";
  const validItems = Array.isArray(result?.items)
    && result.items.length >= 0
    && result.items.length <= 5
    && result.items.every((item) =>
      typeof item.id === "string"
      && typeof item.concept === "string"
      && ["noun", "verb", "person", "phrase"].includes(item.kind)
      && ["A1", "A2", "B1", "B2", "C1", "C2"].includes(item.cefr)
      && Number.isFinite(item.x) && item.x >= 8 && item.x <= 92
      && Number.isFinite(item.y) && item.y >= 10 && item.y <= 88
      && ["text", "meaning"]
        .every((key) => typeof item[key] === "string")
    );
  return Boolean(validSummary && validItems);
}

function rawError(payload, fallback) {
  if (typeof payload === "string" && payload) return payload;
  if (payload && Object.keys(payload).length) {
    try { return JSON.stringify(payload); } catch { return fallback; }
  }
  return fallback;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "仅支持 POST 请求" });
  }
  const identity = await authenticate(req, res);
  if (!identity) return;
  if (!process.env.STEPFUN_API_KEY) {
    return json(res, 503, { error: "服务端尚未配置 STEPFUN_API_KEY" });
  }

  const image = req.body?.image;
  const language = req.body?.language;
  const level = req.body?.level;
  const blacklist = Array.isArray(req.body?.blacklist)
    ? req.body.blacklist
      .filter((item) => typeof item === "string")
      .map((item) => item.toLowerCase().trim())
      .filter(Boolean)
      .slice(0, 200)
    : [];
  if (!LANGUAGES[language]) {
    return json(res, 400, { error: "不支持的目标语言" });
  }
  if (!LEVELS[level]) {
    return json(res, 400, { error: "不支持的学习难度" });
  }
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return json(res, 400, { error: "请提交 JPEG、PNG 或 WebP 图像" });
  }
  const estimatedBytes = Math.ceil((image.length - image.indexOf(",") - 1) * .75);
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    return json(res, 413, { error: "图像过大，请压缩到 4MB 以内" });
  }

  try {
    if (identity.user && !await consumeQuota(identity.user.id, "frame_analysis", Number(process.env.DAILY_ANALYZE_LIMIT || 30))) {
      return json(res, 429, { error: "今日画面分析次数已用完，请明天再来" });
    }
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.STEPFUN_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是视觉语言学习助手。必须只返回符合用户所给 JSON Schema 的 JSON 对象，不要 Markdown 或解释。"
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  `目标语言是${LANGUAGES[language].name}（${LANGUAGES[language].locale}）。`,
                  `目标难度是${LEVELS[level].label}。`,
                  `难度选词规则：${LEVELS[level].instruction}`,
                  "识别画面中最有学习价值且清晰可见的 1-5 个物品、人物、动作或场景短语。",
                  "优先选择可指向明确位置、对日常表达有帮助的内容；不要为了凑数生成不确定标签。",
                  `禁止返回这些跨语言概念及其复数、同义词或翻译：${blacklist.length ? blacklist.join(", ") : "无"}`,
                  "x/y 必须是 0 到 100 之间的数字，表示目标中心相对原图的百分比，避免标签位置彼此过度重叠。",
                  "id 必须是简短的小写英文字母、数字或连字符字符串。",
                  "concept 必须是与语言无关的规范英文小写词元或连字符短语，用于跨语言去重。",
                  "cefr 必须标记该目标语言表达的大致难度。",
                  "text 必须使用目标语言，meaning 必须使用简体中文。",
                  "当前只生成轻量浮窗，不要生成发音、例句或搭配。",
                  "不要推断人物身份、品牌或画面外信息。",
                  `严格遵循这个 JSON Schema：${JSON.stringify(schema)}`
                ].join("\n")
              },
              {
                type: "image_url",
                image_url: { url: image, detail: "low" }
              }
            ]
          }
        ]
      }),
      signal: AbortSignal.timeout(55000)
    });

    const responseText = await response.text();
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = responseText;
    }
    if (!response.ok) {
      return json(res, response.status, { error: rawError(payload, "阶跃星辰接口请求失败") });
    }

    const outputText = payload?.choices?.[0]?.message?.content;
    if (!outputText) {
      return json(res, 502, { error: rawError(payload, "阶跃星辰未返回可用内容") });
    }
    const cleaned = outputText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let result;
    try {
      result = JSON.parse(cleaned);
    } catch {
      return json(res, 502, { error: outputText });
    }
    if (Array.isArray(result?.items)) {
      result.items = result.items.slice(0, 5).map((item, index) => {
        const normalizeCoordinate = (value, min, max) => {
          const number = Number(value);
          const percent = number > 100 ? number / 10 : number;
          return Math.min(max, Math.max(min, Number.isFinite(percent) ? percent : 50));
        };
        const rawId = String(item.id ?? `point-${index + 1}`).toLowerCase();
        return {
          ...item,
          id: rawId.replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || `point-${index + 1}`,
          concept: String(item.concept || item.id || item.text || `point-${index + 1}`)
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-|-$/g, "") || `point-${index + 1}`,
          x: normalizeCoordinate(item.x, 8, 92),
          y: normalizeCoordinate(item.y, 10, 88)
        };
      });
      const blocked = new Set(blacklist);
      result.items = result.items.filter((item) => !blocked.has(item.concept));
    }
    if (!isValidResult(result)) {
      return json(res, 502, { error: outputText });
    }
    if (identity.user) {
      recordEvent(identity.user.id, "frame_analyzed", { language, level, item_count: result.items.length }).catch(() => {});
    }
    return json(res, 200, result);
  } catch (error) {
    console.error("stepfun analyze error", error);
    return json(res, 500, { error: error?.message || String(error) });
  }
};
