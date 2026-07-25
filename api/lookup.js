const { authenticate } = require("./_lib/auth");
const { consumeQuota } = require("./_lib/supabase");
const { normalizeLookupTerm } = require("./_lib/learning");

const MODEL = process.env.STEPFUN_TEXT_MODEL
  || process.env.STEPFUN_VISION_MODEL
  || "step-3.5-flash";
const BASE_URL = (process.env.STEPFUN_BASE_URL || "https://api.stepfun.com/v1").replace(/\/$/, "");
const LANGUAGES = {
  en: { name: "英语" },
  ja: { name: "日语" },
  ko: { name: "韩语" }
};
const LEVELS = {
  beginner: "A1-A2，使用高频、简短、容易记忆的解释。",
  intermediate: "B1-B2，提供自然语境和常见用法。",
  advanced: "C1-C2，解释精确含义和语境差异。"
};
const lookupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["word", "normalized", "phonetic", "meaning", "part_of_speech", "example", "translation"],
  properties: {
    word: { type: "string" },
    normalized: { type: "string" },
    phonetic: { type: "string" },
    meaning: { type: "string" },
    part_of_speech: { type: "string" },
    example: { type: "string" },
    translation: { type: "string" }
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
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  for (const candidate of [cleaned, first >= 0 && last > first ? cleaned.slice(first, last + 1) : ""]) {
    try { return candidate ? JSON.parse(candidate) : null; } catch { /* continue */ }
  }
  return null;
}

function validLookup(result) {
  return ["word", "normalized", "phonetic", "meaning", "part_of_speech", "example", "translation"]
    .every((key) => typeof result?.[key] === "string" && result[key].trim() && result[key].length <= 500);
}

function completeLookup(result, fallback) {
  if (!result || typeof result !== "object" || typeof result.meaning !== "string" || !result.meaning.trim()) return null;
  const completed = {
    word: String(result.word || fallback.term).trim().slice(0, 160),
    normalized: String(result.normalized || result.word || fallback.term).trim().slice(0, 160),
    phonetic: String(result.phonetic || "系统发音").trim().slice(0, 160),
    meaning: result.meaning.trim().slice(0, 200),
    part_of_speech: String(result.part_of_speech || "word").trim().slice(0, 80),
    example: String(result.example || fallback.sentence || fallback.term).trim().slice(0, 500),
    translation: String(result.translation || fallback.sentenceTranslation || result.meaning).trim().slice(0, 500)
  };
  return validLookup(completed) ? completed : null;
}

const FALLBACK_MEANINGS = {
  horse: "马", grassland: "草原", mountain: "山", slope: "山坡", pastoral: "田园的；牧区的",
  scene: "场景", setting: "环境；场景", indoor: "室内的", outdoor: "室外的", coffee: "咖啡",
  machine: "机器", barista: "咖啡师", laptop: "笔记本电脑", bottle: "瓶子", water: "水",
  wooden: "木制的", shelving: "置物架", preparing: "准备；制作", drinks: "饮料", uses: "使用"
};

function fallbackLookup({ term, sentence, sentenceTranslation, language }) {
  const normalized = String(term || "").trim().toLowerCase();
  const meaning = language === "en"
    ? (FALLBACK_MEANINGS[normalized] || `例句中的“${term}”`)
    : `例句中的“${term}”`;
  const example = language === "en"
    ? `${term} appears in this scene.`
    : `${term} ${language === "ja" ? "がこの場面に出てきます。" : "이 장면에 나옵니다."}`;
  return {
    word: term,
    normalized: normalized || term,
    phonetic: "Tap the speaker to listen",
    meaning,
    part_of_speech: "context word",
    example,
    translation: sentenceTranslation || (sentence ? `原句：${sentence}` : `这是“${term}”在画面例句中的用法。`),
    fallback: true
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "仅支持 POST 请求" });
  const identity = await authenticate(req, res);
  if (!identity) return;
  if (!process.env.STEPFUN_API_KEY) return json(res, 503, { error: "服务端尚未配置 STEPFUN_API_KEY" });

  const language = String(req.body?.language || "");
  const level = String(req.body?.level || "");
  const term = normalizeLookupTerm(req.body?.term);
  const sentence = String(req.body?.sentence || "").trim().slice(0, 500);
  const sentenceTranslation = String(req.body?.sentence_translation || "").trim().slice(0, 500);
  if (!LANGUAGES[language]) return json(res, 400, { error: "不支持的目标语言" });
  if (!LEVELS[level]) return json(res, 400, { error: "不支持的学习难度" });
  if (!term) return json(res, 400, { error: "请选择要查询的词或短语" });

  try {
    if (identity.user && !await consumeQuota(identity.user.id, "context_lookup", Number(process.env.DAILY_LOOKUP_LIMIT || 100))) {
      return json(res, 429, { error: "今日句中查词次数已用完，请明天再来" });
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.STEPFUN_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          reasoning_effort: "low",
          temperature: 0.1,
          max_tokens: 650,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                `你是${LANGUAGES[language].name}语境词典。`,
                "结合用户给出的完整例句解释被选择的词或短语，不要脱离语境猜测。",
                "只返回 JSON，不要 Markdown。",
                `严格遵循 JSON Schema：${JSON.stringify(lookupSchema)}`
              ].join("\n")
            },
            {
              role: "user",
              content: [
                `选择内容：${term}`,
                `原例句：${sentence || "未提供"}`,
                `原句翻译：${sentenceTranslation || "未提供"}`,
                `学习难度：${LEVELS[level]}`,
                "word 保留原句中的自然形式；normalized 给出适合词典和收藏的原形；meaning 是本句中的简体中文含义；",
                "phonetic 给出发音；part_of_speech 使用英文词性；example 给出一个短而自然的新例句；translation 是新例句的简体中文翻译。"
              ].join("\n")
            }
          ]
        }),
        signal: AbortSignal.timeout(20000)
      });
      const responseText = await response.text();
      let payload;
      try { payload = JSON.parse(responseText); } catch { payload = null; }
      if (!response.ok) {
        if (response.status === 429) return json(res, 429, { error: "查词请求较多，请稍后再试" });
        if (attempt === 1) return json(res, 200, fallbackLookup({ term, sentence, sentenceTranslation, language }));
        continue;
      }
      const result = completeLookup(
        parseModelJson(payload?.choices?.[0]?.message?.content),
        { term, sentence, sentenceTranslation }
      );
      if (result) return json(res, 200, result);
    }
    return json(res, 200, fallbackLookup({ term, sentence, sentenceTranslation, language }));
  } catch (error) {
    return json(res, 200, fallbackLookup({ term, sentence, sentenceTranslation, language }));
  }
};
