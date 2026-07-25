const MAX_FRAME_BYTES = 1024 * 1024;

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanWord(value) {
  const word = value && typeof value === "object" ? value : {};
  const language = cleanText(word.language, 2);
  const result = {
    concept: cleanText(word.concept, 80),
    language,
    text: cleanText(word.text, 160),
    meaning: cleanText(word.meaning, 200),
    detail: word.detail && typeof word.detail === "object" ? word.detail : null
  };
  if (!result.concept || !["en", "ja", "ko"].includes(language) || !result.text || !result.meaning) return null;
  return result;
}

function readFrameImage(value) {
  if (typeof value !== "string" || !value) return null;
  const matched = /^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!matched) throw new Error("截图仅支持 JPEG 或 WebP 格式");
  const buffer = Buffer.from(matched[2], "base64");
  if (!buffer.length || buffer.length > MAX_FRAME_BYTES) throw new Error("截图不能超过 1MB");
  return { buffer, mimeType: matched[1], extension: matched[1] === "image/webp" ? "webp" : "jpg" };
}

function reviewSchedule(reviewCount) {
  const days = [3, 7, 14, 30, 60];
  return days[Math.min(Math.max(0, reviewCount - 1), days.length - 1)];
}

function normalizeLookupTerm(value) {
  return cleanText(value, 80)
    .replace(/^[\s"'“”‘’()[\]{}.,!?;:，。！？；：、]+|[\s"'“”‘’()[\]{}.,!?;:，。！？；：、]+$/g, "")
    .replace(/\s+/g, " ");
}

module.exports = { cleanText, cleanWord, readFrameImage, reviewSchedule, normalizeLookupTerm };
