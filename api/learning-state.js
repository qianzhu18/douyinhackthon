const { json, methodNotAllowed } = require("./_lib/http");
const { authenticate } = require("./_lib/auth");
const { request } = require("./_lib/supabase");

const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

module.exports = async function handler(req, res) {
  if (!["GET", "PUT"].includes(req.method)) return methodNotAllowed(res, ["GET", "PUT"]);
  const identity = await authenticate(req, res);
  if (!identity || identity.legacy) return identity || undefined;
  const userId = identity.user.id;
  try {
    if (req.method === "GET") {
      const id = encodeURIComponent(userId);
      const [words, blocked, mastery] = await Promise.all([
        request(`/rest/v1/saved_words?user_id=eq.${id}&select=concept,language,text,meaning,detail,source_summary,frame_path,created_at,review_due_at,review_interval_days,review_count,last_reviewed_at&order=created_at.desc&limit=500`),
        request(`/rest/v1/blocked_concepts?user_id=eq.${id}&select=concept,text,meaning,created_at&order=created_at.desc&limit=500`),
        request(`/rest/v1/concept_mastery?user_id=eq.${id}&select=concept,seen,best_score,expression,updated_at&order=updated_at.desc&limit=500`)
      ]);
      return json(res, 200, { words, blocked, mastery });
    }
    const { saved_words = [], blocked_concepts = [], concept_mastery = [] } = req.body || {};
    if (![saved_words, blocked_concepts, concept_mastery].every(Array.isArray)
      || saved_words.length > 500 || blocked_concepts.length > 500 || concept_mastery.length > 500) {
      return json(res, 400, { error: "学习数据格式或数量无效" });
    }
    const validWords = saved_words.map((item) => ({
      user_id: userId, concept: text(item.concept, 80), language: text(item.language, 2), text: text(item.text, 160), meaning: text(item.meaning, 200), detail: item.detail || null
    })).filter((item) => item.concept && ["en", "ja", "ko"].includes(item.language) && item.text && item.meaning);
    const validBlocked = blocked_concepts.map((item) => ({
      user_id: userId, concept: text(item.concept, 80), text: text(item.text, 160) || null, meaning: text(item.meaning, 200) || null
    })).filter((item) => item.concept);
    const validMastery = concept_mastery.map((item) => ({
      user_id: userId, concept: text(item.concept, 80), seen: Math.max(0, Math.min(10000, Number(item.seen) || 0)),
      best_score: Math.max(0, Math.min(100, Number(item.best_score) || 0)), expression: text(item.expression, 600) || null, updated_at: new Date().toISOString()
    })).filter((item) => item.concept);
    await Promise.all([
      validWords.length ? request("/rest/v1/saved_words?on_conflict=user_id,concept,language", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(validWords) }) : null,
      validBlocked.length ? request("/rest/v1/blocked_concepts?on_conflict=user_id,concept", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(validBlocked) }) : null,
      validMastery.length ? request("/rest/v1/concept_mastery?on_conflict=user_id,concept", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(validMastery) }) : null
    ]);
    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 500, { error: "同步学习数据失败" });
  }
};
