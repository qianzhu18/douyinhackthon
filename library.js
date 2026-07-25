const $ = (selector) => document.querySelector(selector);

const STORAGE_SESSION = "frame-language-supabase-session-v1";
const kindLabels = { noun: "名词", person: "人物", verb: "动作", phrase: "场景表达" };
const langLabels = { en: "EN", ja: "JP", ko: "KO" };
const languageLocales = { en: "en-US", ja: "ja-JP", ko: "ko-KR" };

let supabaseConfig = null;
let learningSession = null;
let accountReady = null;
let words = [];
let due = [];
let queue = [];
let queueIndex = 0;

function saveSession(session) {
  learningSession = session;
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(session));
}

async function loadSupabaseConfig() {
  if (supabaseConfig?.supabaseUrl && supabaseConfig?.publishableKey) return supabaseConfig;
  const response = await fetch("/api/client-config");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.supabaseUrl || !payload.publishableKey) {
    throw new Error("学习账户服务暂时不可用");
  }
  supabaseConfig = payload;
  return payload;
}

async function createAnonymousSession() {
  await loadSupabaseConfig();
  const response = await fetch(`${supabaseConfig.supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: supabaseConfig.publishableKey, "Content-Type": "application/json" },
    body: "{}"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error("暂时无法创建学习账户");
  saveSession(payload);
  return payload;
}

async function refreshSession(refreshToken) {
  await loadSupabaseConfig();
  const response = await fetch(`${supabaseConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: supabaseConfig.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error("学习账户续期失败");
  saveSession(payload);
  return payload;
}

async function ensureSession() {
  const now = Math.floor(Date.now() / 1000);
  if (learningSession?.access_token && Number(learningSession.expires_at || 0) > now + 60) return learningSession;
  if (learningSession?.refresh_token) {
    learningSession = null;
    accountReady = null;
  }
  if (!accountReady) {
    accountReady = (async () => {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(STORAGE_SESSION) || "null"); } catch { /* ignored */ }
      if (cached?.access_token && Number(cached.expires_at || 0) > now + 60) {
        learningSession = cached;
        return cached;
      }
      if (cached?.refresh_token) {
        try {
          return await refreshSession(cached.refresh_token);
        } catch {
          localStorage.removeItem(STORAGE_SESSION);
        }
      }
      return createAnonymousSession();
    })().catch((error) => {
      accountReady = null;
      throw error;
    });
  }
  return accountReady;
}

async function apiFetch(path, options = {}) {
  const session = await ensureSession();
  return fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(options.headers || {}) }
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function sceneLabel(word) {
  return word.source_summary?.text || "收藏自一段真实画面";
}

function sceneKey(word) {
  return word.frame_path || sceneLabel(word);
}

function formatDue(value) {
  const delta = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(delta) || delta <= 0) return "今天待复习";
  return `${Math.max(1, Math.ceil(delta / 86400000))} 天后`;
}

function showStatus(mode) {
  $("#libStatus").hidden = mode === "ready";
  $("#libStatusMark").textContent = mode === "error" ? "!" : "↻";
  $("#libStatusTitle").textContent = mode === "error" ? "帧词库暂时没有加载出来" : "正在找回你的帧词库";
  $("#libStatusCopy").textContent = mode === "error"
    ? "你的内容仍保存在云端。检查网络后重新加载即可。"
    : "画面、表达和复习进度会保存在你的匿名学习账户里。";
  $("#libRetry").hidden = mode !== "error";
}

function renderStats() {
  const scenes = new Set(words.map(sceneKey));
  $("#statDue").textContent = due.length;
  $("#statTotal").textContent = words.length;
  $("#statScenes").textContent = scenes.size;
  $("#reviewStart").disabled = due.length === 0;
  $("#reviewStart").innerHTML = due.length
    ? `开始复习 <span>(${due.length})</span>`
    : "今天没有待复习的表达";
}

function renderGroups() {
  const groups = new Map();
  words.forEach((word) => {
    const key = sceneKey(word);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(word);
  });
  $("#sceneGroups").innerHTML = [...groups.values()].map((list) => {
    const scene = sceneLabel(list[0]);
    const cover = list.find((word) => word.frame_url);
    const figure = cover
      ? `<img src="${escapeHtml(cover.frame_url)}" alt="${escapeHtml(scene)}" loading="lazy" />`
      : `<div class="no-frame">帧</div>`;
    const chips = list.map((word) => `
      <button class="word-chip" data-id="${word.id}">
        <b>${escapeHtml(word.text)}</b><small>${escapeHtml(word.meaning)} · ${escapeHtml(word.detail?.cefr || "帧词卡")} · ${formatDue(word.review_due_at)}</small>
      </button>
    `).join("");
    return `
      <article class="scene-group">
        <figure>${figure}<figcaption>${escapeHtml(scene)}</figcaption></figure>
        <div class="scene-words">
          <h3>这一帧里的表达<small>${list.length} 个 · ${langLabels[list[0].language] || ""}</small></h3>
          <div class="word-chips">${chips}</div>
        </div>
      </article>
    `;
  }).join("");
  document.querySelectorAll(".word-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const word = words.find((item) => String(item.id) === chip.dataset.id);
      if (word) startReview([word]);
    });
  });
}

function renderPage() {
  const hasWords = words.length > 0;
  $("#libEmpty").hidden = hasWords;
  $("#libContent").hidden = !hasWords;
  if (hasWords) {
    renderStats();
    renderGroups();
  }
}

async function loadLibrary() {
  showStatus("loading");
  $("#libEmpty").hidden = true;
  $("#libContent").hidden = true;
  try {
    const [libraryResponse, dueResponse] = await Promise.all([
      apiFetch("/api/library?limit=100"),
      apiFetch("/api/review?limit=50")
    ]);
    const libraryPayload = await libraryResponse.json().catch(() => ({}));
    const duePayload = await dueResponse.json().catch(() => ({}));
    if (!libraryResponse.ok) throw new Error(libraryPayload.error || "词库加载失败");
    words = libraryPayload.words || [];
    due = dueResponse.ok ? duePayload.words || [] : [];
    showStatus("ready");
    renderPage();
  } catch {
    showStatus("error");
  }
}

function renderReview() {
  const word = queue[queueIndex];
  $("#reviewProgress").textContent = `${queueIndex + 1} / ${queue.length}`;
  $("#reviewImage").src = word.frame_url || "/cafe-scene.jpg";
  $("#reviewScene").textContent = `场景提示：${sceneLabel(word)}`;
  $("#reviewPrompt").textContent = "先看画面想一想，再显示表达。";
  $("#reviewWord").textContent = word.text;
  $("#reviewMeta").textContent = `${word.detail?.cefr || "FRAME WORD"} · ${kindLabels[word.detail?.kind] || "表达"}`;
  $("#reviewMeaning").textContent = word.meaning;
  $("#reviewAnswer").hidden = true;
  $("#reviewReveal").hidden = false;
  $("#reviewGrade").hidden = true;
}

function startReview(items = due) {
  if (!items.length) return;
  queue = [...items];
  queueIndex = 0;
  $("#reviewCard").hidden = false;
  $("#reviewDone").hidden = true;
  $("#reviewMode").classList.add("open");
  $("#reviewMode").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderReview();
}

function revealAnswer() {
  $("#reviewAnswer").hidden = false;
  $("#reviewReveal").hidden = true;
  $("#reviewGrade").hidden = false;
}

async function grade(action) {
  const word = queue[queueIndex];
  if (!word?.id) return;
  $("#gradeAgain").disabled = true;
  $("#gradeKnown").disabled = true;
  $("#reviewPrompt").textContent = "正在保存复习进度…";
  try {
    const response = await apiFetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: word.id, action })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "复习记录失败");
    words = words.map((item) => item.id === word.id ? { ...item, ...payload.word } : item);
    due = due.filter((item) => item.id !== word.id);
    queueIndex++;
    if (queueIndex >= queue.length) {
      $("#reviewCard").hidden = true;
      $("#reviewDone").hidden = false;
      $("#reviewProgress").textContent = "完成";
      $("#reviewDoneCopy").textContent = action === "remember"
        ? `这张画面会在 ${payload.next_review_in_days} 天后再次出现。`
        : "没关系，这张画面明天会再来一次。";
      renderPage();
    } else {
      renderReview();
    }
  } catch {
    $("#reviewPrompt").textContent = "复习进度没有保存，请再试一次。";
  } finally {
    $("#gradeAgain").disabled = false;
    $("#gradeKnown").disabled = false;
  }
}

function speakCurrentWord() {
  const word = queue[queueIndex];
  if (!word || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word.text);
  utterance.lang = languageLocales[word.language] || "en-US";
  utterance.rate = .84;
  speechSynthesis.speak(utterance);
}

function exitReview() {
  $("#reviewMode").classList.remove("open");
  $("#reviewMode").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

$("#libRetry").addEventListener("click", loadLibrary);
$("#reviewStart").addEventListener("click", () => startReview());
$("#reviewExit").addEventListener("click", exitReview);
$("#reviewReveal").addEventListener("click", revealAnswer);
$("#reviewSpeak").addEventListener("click", speakCurrentWord);
$("#gradeKnown").addEventListener("click", () => grade("remember"));
$("#gradeAgain").addEventListener("click", () => grade("again"));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#reviewMode").classList.contains("open")) exitReview();
});

loadLibrary();
