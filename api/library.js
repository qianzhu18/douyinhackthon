const { json, methodNotAllowed } = require("./_lib/http");
const { authenticate } = require("./_lib/auth");
const { request, uploadPrivateFrame, signedFrameUrl, recordEvent } = require("./_lib/supabase");
const { cleanText, cleanWord, readFrameImage } = require("./_lib/learning");

function queryValue(value) {
  return encodeURIComponent(String(value));
}

async function attachFrameUrls(words) {
  return Promise.all(words.map(async (word) => ({
    ...word,
    frame_url: word.frame_path ? await signedFrameUrl(word.frame_path).catch(() => null) : null
  })));
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return methodNotAllowed(res, ["GET", "POST"]);
  const identity = await authenticate(req, res);
  if (!identity || identity.legacy) return identity || undefined;
  const userId = identity.user.id;
  try {
    if (req.method === "GET") {
      const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 100);
      const language = cleanText(req.query?.language, 2);
      const filters = [`user_id=eq.${queryValue(userId)}`];
      if (["en", "ja", "ko"].includes(language)) filters.push(`language=eq.${language}`);
      const words = await request(`/rest/v1/saved_words?${filters.join("&")}&select=id,concept,language,text,meaning,detail,source_summary,frame_path,created_at,review_due_at,review_interval_days,review_count,last_reviewed_at&order=created_at.desc&limit=${limit}`);
      return json(res, 200, { words: await attachFrameUrls(words || []) });
    }

    const word = cleanWord(req.body?.word || req.body);
    if (!word) return json(res, 400, { error: "请提供完整的词条信息" });
    const sourceSummary = cleanText(req.body?.source_summary, 400);
    const frame = readFrameImage(req.body?.frame_image);
    const insert = {
      user_id: userId,
      ...word,
      source_summary: sourceSummary ? { text: sourceSummary } : null,
      review_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      review_interval_days: 1,
      review_count: 0
    };
    const saved = await request("/rest/v1/saved_words?on_conflict=user_id,concept,language", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([insert])
    });
    const item = saved?.[0];
    if (!item) throw new Error("词条保存失败");
    if (frame) {
      const framePath = `${userId}/${item.id}.${frame.extension}`;
      await uploadPrivateFrame(framePath, frame.mimeType, frame.buffer);
      const updated = await request(`/rest/v1/saved_words?id=eq.${item.id}&user_id=eq.${queryValue(userId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ frame_path: framePath })
      });
      if (updated?.[0]) Object.assign(item, updated[0]);
    }
    await recordEvent(userId, "word_saved", { concept: item.concept, language: item.language }).catch(() => {});
    return json(res, 201, { word: (await attachFrameUrls([item]))[0] });
  } catch (error) {
    return json(res, 500, { error: error.message === "截图不能超过 1MB" || error.message.includes("截图仅支持") ? error.message : "保存词条失败" });
  }
};
