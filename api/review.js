const { json, methodNotAllowed } = require("./_lib/http");
const { authenticate } = require("./_lib/auth");
const { request, signedFrameUrl, recordEvent } = require("./_lib/supabase");
const { reviewSchedule } = require("./_lib/learning");

async function withFrameUrls(words) {
  return Promise.all(words.map(async (word) => ({ ...word, frame_url: word.frame_path ? await signedFrameUrl(word.frame_path).catch(() => null) : null })));
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return methodNotAllowed(res, ["GET", "POST"]);
  const identity = await authenticate(req, res);
  if (!identity || identity.legacy) return identity || undefined;
  const userId = identity.user.id;
  try {
    if (req.method === "GET") {
      const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 50);
      const now = encodeURIComponent(new Date().toISOString());
      const words = await request(`/rest/v1/saved_words?user_id=eq.${encodeURIComponent(userId)}&review_due_at=lte.${now}&select=id,concept,language,text,meaning,detail,source_summary,frame_path,review_due_at,review_interval_days,review_count,last_reviewed_at&order=review_due_at.asc&limit=${limit}`);
      return json(res, 200, { words: await withFrameUrls(words || []) });
    }
    const id = Number(req.body?.id);
    const action = req.body?.action;
    if (!Number.isInteger(id) || id < 1 || !["remember", "again"].includes(action)) return json(res, 400, { error: "复习参数无效" });
    const current = await request(`/rest/v1/saved_words?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}&select=id,concept,language,review_count`);
    const word = current?.[0];
    if (!word) return json(res, 404, { error: "未找到该词条" });
    const count = action === "remember" ? Math.min((word.review_count || 0) + 1, 99) : 0;
    const days = action === "remember" ? reviewSchedule(count) : 1;
    const updated = await request(`/rest/v1/saved_words?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ review_count: count, review_interval_days: days, last_reviewed_at: new Date().toISOString(), review_due_at: new Date(Date.now() + days * 86400000).toISOString() })
    });
    await recordEvent(userId, "review_completed", { concept: word.concept, language: word.language, action }).catch(() => {});
    return json(res, 200, { word: updated?.[0], next_review_in_days: days });
  } catch (error) {
    return json(res, 500, { error: "更新复习进度失败" });
  }
};
