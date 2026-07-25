const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const scene = $("#scene");
const sceneImage = $("#sceneImage");
const sceneVideo = $("#sceneVideo");
const frameCanvas = $("#frameCanvas");
const mediaInput = $("#mediaInput");
const tagsLayer = $("#tagsLayer");
const analysisState = $("#analysisState");
const languageMenu = $("#languageMenu");
const learningToolbar = $("#learningToolbar");
const playerControls = $("#playerControls");
const wordSheet = $("#wordSheet");
const toast = $("#toast");

const languageConfig = {
  en: { label: "EN", name: "英语", locale: "en-US" },
  ja: { label: "JP", name: "日语", locale: "ja-JP" },
  ko: { label: "KO", name: "韩语", locale: "ko-KR" }
};
const kindLabels = {
  noun: "NOUN · 名词",
  person: "PERSON · 人物",
  verb: "VERB · 动作",
  phrase: "PHRASE · 场景表达"
};
const STORAGE_ACCESS = "frame-language-access";
const STORAGE_LEVEL = "frame-language-level";
const STORAGE_BLACKLIST = "frame-language-blacklist";
const STORAGE_SESSION = "frame-language-supabase-session-v1";
const STORAGE_LIBRARY_CACHE = "frame-language-library-cache-v1";
const STORAGE_SOUND = "frame-language-ambient-sound";
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

let currentLang = "en";
let currentLevel = ["beginner", "intermediate", "advanced"].includes(localStorage.getItem(STORAGE_LEVEL))
  ? localStorage.getItem(STORAGE_LEVEL)
  : "beginner";
let currentItem = null;
let currentFrame = null;
let frameHistory = [];
let mediaSession = 0;
let objectUrl = null;
let cameraStream = null;
let cameraFacing = "environment";
let cameraSwitching = false;
let mediaMode = "sample";
let isPaused = false;
let isAnalyzing = false;
let requestToken = 0;
let pendingAction = null;
let supabaseConfig = null;
let learningSession = null;
let accountReady = null;
let libraryWords = [];
let dueWords = [];
let reviewTarget = null;
let contextLookup = null;
let contextLookupTerm = "";
let contextLookupToken = 0;
let contextPressTimer = null;
let soundEnabled = localStorage.getItem(STORAGE_SOUND) !== "off";
let ambientContext = null;
let ambientMaster = null;
let ambientNodes = [];

function getLegacyAccessCode() {
  return localStorage.getItem(STORAGE_ACCESS) || "";
}

const levelConfig = {
  beginner: { label: "A1–A2", name: "基础" },
  intermediate: { label: "B1–B2", name: "进阶" },
  advanced: { label: "C1–C2", name: "高阶" }
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 1900);
}

function updateSoundUI() {
  $("#muteLabel").textContent = soundEnabled ? "氛围声已开" : "开启氛围声";
  $("#muteIcon").textContent = soundEnabled ? "♫" : "♪";
  sceneVideo.muted = !soundEnabled || mediaMode === "camera";
}

async function startAmbient() {
  if (!soundEnabled) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    soundEnabled = false;
    updateSoundUI();
    return;
  }
  if (!ambientContext) {
    ambientContext = new AudioContextClass();
    ambientMaster = ambientContext.createGain();
    ambientMaster.gain.value = 0.0001;
    const filter = ambientContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 820;
    filter.Q.value = .4;
    ambientMaster.connect(filter);
    filter.connect(ambientContext.destination);
    [196, 246.94, 293.66].forEach((frequency, index) => {
      const oscillator = ambientContext.createOscillator();
      const gain = ambientContext.createGain();
      oscillator.type = index === 1 ? "triangle" : "sine";
      oscillator.frequency.value = frequency / 2;
      gain.gain.value = index === 1 ? .055 : .035;
      oscillator.connect(gain);
      gain.connect(ambientMaster);
      oscillator.start();
      ambientNodes.push(oscillator, gain);
    });
  }
  if (ambientContext.state === "suspended") await ambientContext.resume();
  ambientMaster.gain.cancelScheduledValues(ambientContext.currentTime);
  ambientMaster.gain.linearRampToValueAtTime(.12, ambientContext.currentTime + 1.4);
}

function duckAmbient(ducked) {
  if (!ambientContext || !ambientMaster) return;
  ambientMaster.gain.cancelScheduledValues(ambientContext.currentTime);
  ambientMaster.gain.linearRampToValueAtTime(ducked ? .025 : soundEnabled ? .12 : .0001, ambientContext.currentTime + .18);
}

async function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(STORAGE_SOUND, soundEnabled ? "on" : "off");
  updateSoundUI();
  if (soundEnabled) {
    await startAmbient();
    showToast("已开启轻柔背景氛围声");
  } else {
    duckAmbient(false);
    if (ambientContext?.state === "running") await ambientContext.suspend();
    showToast("已关闭背景氛围声");
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function saveSession(session) {
  learningSession = session;
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(session));
}

// The anonymous Supabase refresh token is the device-bound learning identity.
// Keep a small local mirror as well: it makes a transient Auth/network outage
// non-destructive and lets the library feel continuous while it reconnects.
function currentSessionUserId() {
  return String(learningSession?.user?.id || "");
}

function readLibraryCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(STORAGE_LIBRARY_CACHE) || "null");
    return Array.isArray(cache?.words) ? cache : null;
  } catch {
    return null;
  }
}

function persistLibraryCache() {
  const words = libraryWords.slice(0, 500);
  localStorage.setItem(STORAGE_LIBRARY_CACHE, JSON.stringify({
    userId: currentSessionUserId(),
    savedAt: Date.now(),
    words,
    dueWords
  }));
}

function restoreLibraryCache() {
  const cache = readLibraryCache();
  if (!cache) return false;
  const activeUserId = currentSessionUserId();
  if (activeUserId && cache.userId && cache.userId !== activeUserId) return false;
  libraryWords = cache.words;
  dueWords = Array.isArray(cache.dueWords) ? cache.dueWords : [];
  updateLibraryUI();
  return libraryWords.length > 0;
}

async function loadSupabaseConfig() {
  if (supabaseConfig?.supabaseUrl && supabaseConfig?.publishableKey) return supabaseConfig;
  const configResponse = await fetch("/api/client-config");
  supabaseConfig = await configResponse.json().catch(() => ({}));
  if (!configResponse.ok || !supabaseConfig.supabaseUrl || !supabaseConfig.publishableKey) {
    throw new Error(supabaseConfig.error || "学习账户服务暂不可用");
  }
  return supabaseConfig;
}

async function startAnonymousSession() {
  await loadSupabaseConfig();
  const response = await fetch(`${supabaseConfig.supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: supabaseConfig.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error("学习账户尚未开启。请在 Supabase Auth 打开 Anonymous Sign-ins 后重试。");
  }
  saveSession(payload);
  return payload;
}

async function refreshLearningSession(refreshToken) {
  if (!refreshToken) throw new Error("没有可续期的学习账户");
  await loadSupabaseConfig();
  const response = await fetch(`${supabaseConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: supabaseConfig.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error("学习账户续期失败");
    // Only discard a device identity when Supabase explicitly says its token is
    // invalid. A timeout/5xx must not silently create a new anonymous user.
    error.permanentSessionFailure = [400, 401, 403].includes(response.status);
    throw error;
  }
  saveSession(payload);
  return payload;
}

async function ensureLearningSession() {
  const now = Math.floor(Date.now() / 1000);
  if (learningSession?.access_token && Number(learningSession.expires_at || 0) > now + 60) return learningSession;
  if (learningSession?.refresh_token) {
    learningSession = null;
    accountReady = null;
  }
  if (!accountReady) {
    accountReady = (async () => {
      let cached = null;
      try {
        cached = JSON.parse(localStorage.getItem(STORAGE_SESSION) || "null");
        if (cached?.access_token && Number(cached.expires_at || 0) > Math.floor(Date.now() / 1000) + 60) {
          learningSession = cached;
          return cached;
        }
      } catch { /* ignored */ }
      if (cached?.refresh_token) {
        try {
          return await refreshLearningSession(cached.refresh_token);
        } catch (error) {
          if (error?.permanentSessionFailure) {
            localStorage.removeItem(STORAGE_SESSION);
          } else {
            learningSession = cached;
            throw new Error("学习账户暂时无法连接；已保留本机词库，网络恢复后会自动找回");
          }
        }
      }
      try {
        return await startAnonymousSession();
      } catch (error) {
        // Do not break the already-working small-scope demo while an admin is
        // enabling anonymous Auth. Legacy access remains analysis-only; the
        // cloud library correctly continues to require a real user identity.
        const code = getLegacyAccessCode();
        if (code) return { legacy: true, accessCode: code };
        throw error;
      }
    })().catch((error) => {
      accountReady = null;
      throw error;
    });
  }
  return accountReady;
}

async function apiFetch(path, options = {}) {
  const session = await ensureLearningSession();
  if (session.legacy) {
    return fetch(path, {
      ...options,
      headers: { "X-Access-Code": session.accessCode, ...(options.headers || {}) }
    });
  }
  return fetch(path, {
    ...options,
    headers: { "Authorization": `Bearer ${session.access_token}`, ...(options.headers || {}) }
  });
}

function requestUpload() {
  mediaInput.click();
}

function requestCamera() {
  startCamera(cameraFacing);
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  if (sceneVideo.srcObject) sceneVideo.srcObject = null;
  sceneVideo.classList.remove("front-camera");
}

async function requestCameraStream(facing) {
  const video = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: { exact: facing }
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (error) {
    if (!["OverconstrainedError", "NotFoundError"].includes(error.name)) throw error;
    return navigator.mediaDevices.getUserMedia({
      video: { ...video, facingMode: { ideal: facing } },
      audio: false
    });
  }
}

async function updateCameraControls() {
  let videoInputs = [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoInputs = devices.filter((device) => device.kind === "videoinput");
  } catch { /* switching remains hidden when devices cannot be enumerated */ }
  $("#flipCamera").hidden = videoInputs.length < 2;
  $("#cameraFacingLabel").textContent = `${cameraFacing === "user" ? "前置" : "后置"}镜头实时预览`;
  sceneVideo.classList.toggle("front-camera", cameraFacing === "user");
}

function resetLearningState() {
  requestToken++;
  isAnalyzing = false;
  isPaused = false;
  currentFrame = null;
  currentItem = null;
  frameHistory = [];
  tagsLayer.innerHTML = "";
  closeWordSheet();
  setAnalysisState("hidden");
  scene.classList.remove("paused");
  learningToolbar.classList.remove("visible");
  playerControls.classList.remove("hidden");
  $("#welcomeTip").classList.remove("hidden");
}

function loadVideo(file) {
  if (!file) return;
  if (!file.type.startsWith("video/")) return showToast("请选择视频文件");
  if (file.size > MAX_VIDEO_BYTES) return showToast("视频不能超过 500MB");
  stopCamera();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  mediaSession++;
  mediaMode = "video";
  resetLearningState();
  sceneImage.hidden = true;
  sceneVideo.hidden = false;
  sceneVideo.src = objectUrl;
  sceneVideo.muted = !soundEnabled;
  sceneVideo.loop = false;
  updateSoundUI();
  $("#sourceBadge").textContent = file.name;
  $("#timelineRow").hidden = false;
  $("#cameraLive").hidden = true;
  $("#muteButton").hidden = false;
  $("#replaceButton").textContent = "更换视频";
  $("#welcomeTip b").textContent = "视频已载入";
  $("#welcomeTip small").textContent = "点击画面或按空格暂停识别";
  sceneVideo.onloadedmetadata = () => {
    $("#duration").textContent = formatTime(sceneVideo.duration);
    sceneVideo.play().catch(() => showToast("点击画面开始播放"));
  };
  sceneVideo.onended = () => {
    showToast("视频播放结束");
    playerControls.classList.remove("hidden");
  };
}

async function startCamera(facing = "environment", restoring = false) {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("当前浏览器或地址不支持摄像头");
    return false;
  }
  try {
    stopCamera();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    cameraStream = await requestCameraStream(facing);
    const actualFacing = cameraStream.getVideoTracks()[0]?.getSettings?.().facingMode;
    cameraFacing = ["user", "environment"].includes(actualFacing) ? actualFacing : facing;
    mediaSession++;
    mediaMode = "camera";
    resetLearningState();
    sceneImage.hidden = true;
    sceneVideo.hidden = false;
    sceneVideo.removeAttribute("src");
    sceneVideo.srcObject = cameraStream;
    sceneVideo.muted = true;
    $("#sourceBadge").textContent = "实时摄像头";
    $("#timelineRow").hidden = true;
    $("#cameraLive").hidden = false;
    $("#muteButton").hidden = false;
    $("#replaceButton").textContent = "选择视频";
    $("#welcomeTip b").textContent = "摄像头模式已开启";
    $("#welcomeTip small").textContent = "点击画面或按空格冻结当前帧";
    await sceneVideo.play();
    await updateCameraControls();
    return true;
  } catch (error) {
    stopCamera();
    if (!restoring && mediaMode === "camera") return startCamera(cameraFacing, true);
    const message = error.name === "NotAllowedError"
      ? "没有获得摄像头权限，请在浏览器设置中允许访问"
      : `摄像头启动失败：${error.message}`;
    showToast(message);
    return false;
  }
}

async function switchCamera() {
  if (cameraSwitching || mediaMode !== "camera") return;
  cameraSwitching = true;
  const previousFacing = cameraFacing;
  const nextFacing = previousFacing === "environment" ? "user" : "environment";
  $("#flipCamera").disabled = true;
  $("#flipCamera").textContent = "切换中…";
  const switched = await startCamera(nextFacing, true);
  if (!switched) {
    await startCamera(previousFacing, true);
    showToast("这台设备暂时无法切换镜头");
  } else {
    showToast(`已切换到${cameraFacing === "user" ? "前置" : "后置"}镜头`);
  }
  $("#flipCamera").disabled = false;
  $("#flipCamera").textContent = "↺ 切换镜头";
  cameraSwitching = false;
}

function captureFrame() {
  const source = sceneVideo.hidden ? sceneImage : sceneVideo;
  const width = source.naturalWidth || source.videoWidth;
  const height = source.naturalHeight || source.videoHeight;
  if (!width || !height) throw new Error("视频画面尚未准备好");
  // The private vocabulary snapshot is capped at 1MB by Storage. 720px keeps
  // the image useful as a visual cue while reliably fitting that product limit.
  const scale = Math.min(1, 720 / Math.max(width, height));
  frameCanvas.width = Math.max(1, Math.round(width * scale));
  frameCanvas.height = Math.max(1, Math.round(height * scale));
  frameCanvas.getContext("2d").drawImage(source, 0, 0, frameCanvas.width, frameCanvas.height);
  return frameCanvas.toDataURL("image/jpeg", .74);
}

function findNearbyFrame(time) {
  return frameHistory.find((frame) =>
    frame.mediaSession === mediaSession && Math.abs(frame.time - time) <= 1
  );
}

async function pauseAndAnalyze() {
  if (isPaused || isAnalyzing) return;
  try { await ensureLearningSession(); } catch (error) { showToast(error.message); return; }
  const time = mediaMode === "camera"
    ? Date.now() / 1000
    : sceneVideo.hidden ? 0 : sceneVideo.currentTime;
  if (!sceneVideo.hidden) sceneVideo.pause();
  isPaused = true;
  scene.classList.add("paused");
  $("#welcomeTip").classList.add("hidden");
  playerControls.classList.add("hidden");
  learningToolbar.classList.add("visible");
  closeWordSheet();

  currentFrame = findNearbyFrame(time);
  if (!currentFrame) {
    try {
      currentFrame = {
        id: `${mediaSession}:${time.toFixed(3)}:${Date.now()}`,
        mediaSession,
        time,
        image: captureFrame(),
        results: {}
      };
      frameHistory.push(currentFrame);
    } catch (error) {
      return showAnalysisError(error.message);
    }
  }
  await loadLanguageResult();
}

function continuePlaying() {
  requestToken++;
  isAnalyzing = false;
  isPaused = false;
  currentItem = null;
  closeWordSheet();
  tagsLayer.innerHTML = "";
  setAnalysisState("hidden");
  scene.classList.remove("paused");
  learningToolbar.classList.remove("visible");
  playerControls.classList.remove("hidden");
  $("#retryAnalysis").hidden = true;
  if (!sceneVideo.hidden) sceneVideo.play().catch(() => showToast("无法自动播放，请点击画面"));
}

async function loadLanguageResult(force = false) {
  if (!currentFrame) return;
  closeWordSheet();
  tagsLayer.innerHTML = "";
  $("#retryAnalysis").hidden = true;

  const cacheKey = `${currentLang}:${currentLevel}`;
  if (!force && currentFrame.results[cacheKey]) {
    renderResult(currentFrame.results[cacheKey]);
    return;
  }

  const token = ++requestToken;
  isAnalyzing = true;
  setAnalysisState("loading", `正在生成${languageConfig[currentLang].name}学习点…`);
  $("#learningCount").textContent = "AI 正在分析";
  try {
    const response = await apiFetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        image: currentFrame.image,
        language: currentLang,
        level: currentLevel,
        blacklist: getBlacklist().map((item) => item.concept)
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.raw || `请求失败（${response.status}）`);
    }
    if (token !== requestToken || !isPaused) return;
    currentFrame.results[cacheKey] = payload;
    renderResult(payload);
  } catch (error) {
    if (token === requestToken) showAnalysisError(error.message);
  } finally {
    if (token === requestToken) isAnalyzing = false;
  }
}

function setAnalysisState(state, message = "") {
  analysisState.className = "analysis-state";
  if (state === "hidden") return;
  analysisState.classList.add("visible");
  if (state === "error") analysisState.classList.add("error");
  $("#analysisTitle").textContent = state === "error" ? "分析失败" : "正在理解这一帧";
  $("#analysisMessage").textContent = message;
}

function showAnalysisError(rawMessage) {
  isAnalyzing = false;
  setAnalysisState("error", rawMessage || "未知错误");
  $("#learningCount").textContent = "未能完成分析";
  $("#retryAnalysis").textContent = "重新分析";
  $("#retryAnalysis").hidden = false;
}

function renderResult(result) {
  setAnalysisState("hidden");
  const blocked = new Set(getBlacklist().map((item) => item.concept));
  const items = result.items.filter((item) => !blocked.has(item.concept)).slice(0, 5);
  $("#learningCount").textContent = items.length
    ? `发现 ${items.length} 个${levelConfig[currentLevel].name}学习点`
    : "这一帧没有新的学习点";
  tagsLayer.innerHTML = items.map((item, index) => `
    <button class="word-tag ${item.kind}" style="--x:${item.x}%;--y:${item.y}%;animation-delay:${index * .045}s" data-index="${index}">
      <span class="pin"></span><b></b><small></small>
    </button>
  `).join("");
  $$(".word-tag").forEach((tag) => {
    const item = items[Number(tag.dataset.index)];
    tag.querySelector("b").textContent = item.text;
    tag.querySelector("small").textContent = `${item.meaning} · ${item.cefr}`;
    tag.addEventListener("click", (event) => {
      event.stopPropagation();
      openWordSheet(item);
    });
  });
  $("#retryAnalysis").textContent = "重新识别这一帧";
  $("#retryAnalysis").hidden = false;
}

function sentenceSegments(text) {
  if (!text) return [];
  if ("Segmenter" in Intl) {
    return [...new Intl.Segmenter(languageConfig[currentLang].locale, { granularity: "word" }).segment(text)]
      .map((part) => ({ text: part.segment, isWord: part.isWordLike }));
  }
  return String(text).split(/(\s+|[.,!?;:，。！？；：、]+)/).filter(Boolean)
    .map((part) => ({ text: part, isWord: /[\p{L}\p{N}]/u.test(part) }));
}

function renderContextSentence(text) {
  const container = $("#contextText");
  container.innerHTML = "";
  sentenceSegments(text).forEach((part) => {
    if (!part.isWord) {
      container.append(document.createTextNode(part.text));
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-token";
    button.dataset.term = part.text;
    button.textContent = part.text;
    button.setAttribute("aria-label", `查询 ${part.text}`);
    container.append(button);
  });
  $("#contextHint").hidden = !container.querySelector(".context-token");
}

function renderCollocations(tags = []) {
  $("#collocations").innerHTML = tags.length
    ? tags.map((tag) => `<button type="button" data-term="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")
    : "";
}

function closeContextExplorer() {
  contextLookupToken++;
  contextLookup = null;
  contextLookupTerm = "";
  $("#contextExplorer").hidden = true;
  $$(".context-token").forEach((token) => token.classList.remove("active"));
}

function contextWordKey(item = contextLookup) {
  return item ? `${item.language}:${item.concept}` : "";
}

function updateContextSaveButton() {
  const saved = libraryWords.some((word) => `${word.language}:${word.concept}` === contextWordKey());
  $("#saveContextWord").classList.toggle("saved", saved);
  $("#saveContextWord").textContent = saved ? "✓ 已加入帧词库" : "＋ 把这个词加入帧词库";
}

async function openContextLookup(term) {
  const cleanTerm = String(term || "").trim();
  if (!cleanTerm || !currentItem?.detail?.context) return;
  contextLookupTerm = cleanTerm;
  contextLookup = null;
  const token = ++contextLookupToken;
  $("#contextExplorer").hidden = false;
  $("#contextExplorerLoading").hidden = false;
  $("#contextExplorerResult").hidden = true;
  $("#contextExplorerError").hidden = true;
  $("#contextLookupTitle").textContent = `正在理解 “${cleanTerm}”…`;
  $$(".context-token").forEach((item) => item.classList.toggle("active", item.dataset.term === cleanTerm));
  $("#contextExplorer").scrollIntoView({ block: "nearest", behavior: "smooth" });
  try {
    const response = await apiFetch("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: currentLang,
        level: currentLevel,
        term: cleanTerm,
        sentence: currentItem.detail.context,
        sentence_translation: currentItem.detail.translation
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "暂时没有查到这个词");
    if (token !== contextLookupToken) return;
    const normalized = String(payload.normalized || cleanTerm).trim().toLowerCase();
    contextLookup = {
      concept: `context:${normalized}`.slice(0, 80),
      language: currentLang,
      text: payload.word || cleanTerm,
      meaning: payload.meaning,
      cefr: currentItem.cefr,
      kind: "context",
      detail: {
        phonetic: payload.phonetic,
        context: currentItem.detail.context,
        translation: currentItem.detail.translation,
        exploration_example: payload.example,
        exploration_translation: payload.translation,
        part_of_speech: payload.part_of_speech,
        cefr: currentItem.cefr,
        kind: "context",
        origin: "sentence"
      }
    };
    $("#contextWord").textContent = contextLookup.text;
    $("#contextPhonetic").textContent = `${payload.phonetic} · ${payload.part_of_speech}`;
    $("#contextMeaning").textContent = payload.meaning;
    $("#contextExample").textContent = payload.example;
    $("#contextExampleTranslation").textContent = payload.translation;
    $("#contextExplorerLoading").hidden = true;
    $("#contextExplorerResult").hidden = false;
    updateContextSaveButton();
  } catch (error) {
    if (token !== contextLookupToken) return;
    $("#contextExplorerLoading").hidden = true;
    $("#contextExplorerError").hidden = false;
    $("#contextExplorerErrorText").textContent = error.message;
  }
}

async function saveContextLookup() {
  if (!contextLookup) return;
  if (libraryWords.some((word) => `${word.language}:${word.concept}` === contextWordKey())) {
    openLibrary();
    return;
  }
  const item = contextLookup;
  $("#saveContextWord").disabled = true;
  $("#saveContextWord").textContent = "正在保存这张语境卡…";
  try {
    const response = await apiFetch("/api/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word: item,
        source_summary: `来自画面例句：${currentItem?.detail?.context || item.detail.context}`,
        frame_image: currentFrame?.image
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "保存到帧词库失败");
    libraryWords = [payload.word, ...libraryWords.filter((word) => `${word.language}:${word.concept}` !== contextWordKey(item))];
    reviewTarget = payload.word;
    persistLibraryCache();
    updateLibraryUI();
    updateContextSaveButton();
    showToast(`已把 “${item.text}” 和原句一起收藏`);
  } catch (error) {
    showToast(error.message);
    updateContextSaveButton();
  } finally {
    $("#saveContextWord").disabled = false;
  }
}

async function openWordSheet(item) {
  currentItem = item;
  closeContextExplorer();
  $("#wordType").textContent = kindLabels[item.kind] || "EXPRESSION · 表达";
  $("#wordText").textContent = item.text;
  $("#phonetic").textContent = item.detail?.phonetic || "正在生成详情…";
  $("#meaningText").textContent = item.meaning;
  if (item.detail?.context) renderContextSentence(item.detail.context);
  else $("#contextText").textContent = "正在结合画面生成自然例句…";
  $("#translationText").textContent = item.detail?.translation || "请稍候";
  $("#contextHint").hidden = !item.detail?.context;
  if (item.detail) renderCollocations(item.detail.tags);
  else $("#collocations").innerHTML = "<button type=\"button\">生成常用搭配中…</button>";
  $("#retryDetail").hidden = true;
  // Saving the visual word card must never depend on a second model call.
  $("#saveWord").disabled = false;
  updateSaveButton();
  wordSheet.classList.add("open");
  wordSheet.setAttribute("aria-hidden", "false");
  if (item.detail || item.detailLoading) return;

  item.detailLoading = true;
  try {
    const result = currentFrame?.results[`${currentLang}:${currentLevel}`];
    const response = await apiFetch("/api/detail", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        language: currentLang,
        level: currentLevel,
        item: { text: item.text, meaning: item.meaning, kind: item.kind },
        summary: result?.summary
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `详情请求失败（${response.status}）`);
    item.detail = payload;
    if (currentItem !== item) return;
    $("#phonetic").textContent = payload.phonetic;
    renderContextSentence(payload.context);
    $("#translationText").textContent = payload.translation;
    renderCollocations(payload.tags);
    $("#retryDetail").hidden = true;
    updateSaveButton();
  } catch {
    if (currentItem === item) {
      $("#phonetic").textContent = "详情稍后再试";
      $("#contextText").textContent = "详细例句暂时没有生成出来，但不影响收藏这张帧词卡。";
      $("#translationText").textContent = "你可以先加入词库，或点击下方重新生成。";
      $("#collocations").innerHTML = "";
      $("#retryDetail").hidden = false;
    }
  } finally {
    item.detailLoading = false;
  }
}

function closeWordSheet() {
  closeContextExplorer();
  wordSheet.classList.remove("open");
  wordSheet.setAttribute("aria-hidden", "true");
  currentItem = null;
}

function getBlacklist() {
  try {
    const values = JSON.parse(localStorage.getItem(STORAGE_BLACKLIST) || "[]");
    return Array.isArray(values)
      ? values.map((item) => typeof item === "string"
        ? { concept: item, text: item, meaning: "" }
        : item
      ).filter((item) => item?.concept)
      : [];
  } catch {
    return [];
  }
}

function saveBlacklist(items) {
  localStorage.setItem(STORAGE_BLACKLIST, JSON.stringify(items));
  updateBlacklistUI();
}

function blockCurrentItem() {
  if (!currentItem?.concept) return;
  const blockedItem = currentItem;
  const items = getBlacklist();
  if (!items.some((item) => item.concept === blockedItem.concept)) {
    items.push({
      concept: blockedItem.concept,
      text: blockedItem.text,
      meaning: blockedItem.meaning,
      blockedAt: Date.now()
    });
    saveBlacklist(items);
  }
  closeWordSheet();
  const result = currentFrame?.results[`${currentLang}:${currentLevel}`];
  if (result) renderResult(result);
  showToast(`“${blockedItem.text}”以后不再出现`);
}

function restoreConcept(concept) {
  saveBlacklist(getBlacklist().filter((item) => item.concept !== concept));
  renderBlacklist();
  const result = currentFrame?.results[`${currentLang}:${currentLevel}`];
  if (isPaused && result) renderResult(result);
}

function updateBlacklistUI() {
  const count = getBlacklist().length;
  $("#blacklistCount").textContent = count;
  $("#blacklistEmpty").hidden = count > 0;
  $("#clearBlacklist").hidden = count === 0;
}

function renderBlacklist() {
  const items = getBlacklist();
  $("#blacklistList").innerHTML = items.map((item) => `
    <article class="blacklist-item">
      <div><b>${escapeHtml(item.text || item.concept)}</b><small>${escapeHtml(item.meaning || item.concept)}</small></div>
      <button data-concept="${escapeHtml(item.concept)}">恢复显示</button>
    </article>
  `).join("");
  $$("#blacklistList button").forEach((button) => {
    button.addEventListener("click", () => restoreConcept(button.dataset.concept));
  });
  updateBlacklistUI();
}

function wordKey(item = currentItem) {
  return item ? `${item.language || currentLang}:${item.concept}` : "";
}

function updateSaveButton() {
  const saved = libraryWords.some((word) => `${word.language}:${word.concept}` === wordKey());
  $("#saveWord").classList.toggle("saved", saved);
  $("#saveWord").textContent = saved ? "✓ 已在帧词库" : "＋ 加入帧词库";
}

async function toggleSaveWord() {
  if (!currentItem) return;
  const savingItem = currentItem;
  if (libraryWords.some((word) => `${word.language}:${word.concept}` === wordKey(savingItem))) {
    openLibrary();
    return;
  }
  $("#saveWord").disabled = true;
  $("#saveWord").textContent = "正在收进词库…";
  try {
    const result = currentFrame?.results[`${currentLang}:${currentLevel}`];
    const word = {
      concept: savingItem.concept,
      language: currentLang,
      text: savingItem.text,
      meaning: savingItem.meaning,
      detail: { ...(savingItem.detail || {}), cefr: savingItem.cefr, kind: savingItem.kind }
    };
    const response = await apiFetch("/api/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word,
        source_summary: result?.summary?.zh || result?.summary?.target || "来自一帧暂停画面",
        frame_image: currentFrame?.image
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "保存到帧词库失败");
    libraryWords = [payload.word, ...libraryWords.filter((item) => `${item.language}:${item.concept}` !== wordKey(savingItem))];
    reviewTarget = payload.word;
    persistLibraryCache();
    updateLibraryUI();
    updateSaveButton();
    showToast("已加入帧词库，马上用这段画面复习一次");
    openLibrary(true);
  } catch (error) {
    showToast(error.message);
    updateSaveButton();
  } finally {
    $("#saveWord").disabled = false;
  }
}

function formatReviewTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "等待复习";
  const delta = date.getTime() - Date.now();
  if (delta <= 0) return "今天待复习";
  const days = Math.max(1, Math.ceil(delta / 86400000));
  return `${days} 天后复习`;
}

async function loadLibrary() {
  setLibraryState("loading");
  try {
    const [libraryResponse, dueResponse] = await Promise.all([
      apiFetch("/api/library?limit=100"),
      apiFetch("/api/review?limit=50")
    ]);
    const libraryPayload = await libraryResponse.json().catch(() => ({}));
    const duePayload = await dueResponse.json().catch(() => ({}));
    if (!libraryResponse.ok) throw new Error(libraryPayload.error || "词库加载失败");
    libraryWords = libraryPayload.words || [];
    dueWords = dueResponse.ok ? duePayload.words || [] : [];
    persistLibraryCache();
    setLibraryState("ready");
    updateLibraryUI();
  } catch (error) {
    const recovered = restoreLibraryCache();
    setLibraryState(recovered ? "cached" : "error");
    if (!recovered) {
      $("#libraryList").innerHTML = "";
      $("#libraryEmpty").hidden = true;
    }
  }
}

function setLibraryState(state) {
  const stateCard = $("#libraryState");
  if (state === "ready") {
    stateCard.hidden = true;
    return;
  }
  stateCard.hidden = false;
  $("#retryLibrary").hidden = state === "loading";
  $("#libraryStateTitle").textContent = state === "error"
    ? "帧词库暂时没加载出来"
    : state === "cached" ? "正在显示本机词库备份" : "正在加载帧词库";
  $("#libraryStateMessage").textContent = state === "error"
    ? "你的识别结果还在。检查网络后可以直接重试，不需要重新识别。"
    : state === "cached"
      ? "云端暂时不可达；本机已保存的词卡仍可查看，恢复网络后点此重新同步。"
      : "正在找回你收藏过的画面和表达。";
}

function updateLibraryUI() {
  $("#libraryCount").textContent = libraryWords.length;
  $("#libraryTotal").textContent = libraryWords.length;
  $("#dueCount").textContent = dueWords.length;
  $("#sceneCount").textContent = new Set(libraryWords.map((word) => word.frame_path || word.created_at)).size;
  $("#startReview").disabled = !dueWords.length && !reviewTarget;
  $("#startReview").textContent = dueWords.length ? `复习今天的 ${dueWords.length} 张词卡` : reviewTarget ? "立即复习刚收藏的词卡" : "今天没有待复习的词卡";
  $("#libraryEmpty").hidden = libraryWords.length > 0;
  $("#libraryList").innerHTML = libraryWords.map((word) => `
    <article class="library-card">
      ${word.frame_url ? `<img src="${escapeHtml(word.frame_url)}" alt="${escapeHtml(word.text)} 对应画面" />` : "<div></div>"}
      <div><b>${escapeHtml(word.text)}</b><small>${escapeHtml(word.meaning)} · ${escapeHtml(word.detail?.cefr || "帧词卡")}</small><small class="card-status">${formatReviewTime(word.review_due_at)}</small><button class="review-now" data-id="${word.id}">用这张卡复习</button></div>
    </article>
  `).join("");
  $$(".review-now").forEach((button) => button.addEventListener("click", () => {
    const word = libraryWords.find((item) => String(item.id) === button.dataset.id);
    if (word) openReview(word);
  }));
}

async function openLibrary(focusLatest = false) {
  try { await ensureLearningSession(); } catch (error) { return showToast(error.message); }
  $("#blacklistPanel").classList.remove("open");
  $("#libraryPanel").classList.add("open");
  $("#libraryPanel").setAttribute("aria-hidden", "false");
  await loadLibrary();
  if (focusLatest && reviewTarget) updateLibraryUI();
}

function closeLibrary() {
  $("#libraryPanel").classList.remove("open");
  $("#libraryPanel").setAttribute("aria-hidden", "true");
}

function openReview(word) {
  reviewTarget = word;
  $("#reviewImage").src = word.frame_url || currentFrame?.image || "/cafe-scene.jpg";
  $("#reviewLevel").textContent = `${word.detail?.cefr || "FRAME WORD"} · ${word.detail?.kind || "表达"}`;
  $("#reviewMeaning").textContent = word.source_summary?.text || word.meaning;
  $("#reviewExample").textContent = word.detail?.context || "";
  $("#reviewExample").hidden = true;
  $("#reviewTranslation").textContent = word.detail?.translation || "";
  $("#reviewTranslation").hidden = true;
  $("#reviewAnswer").textContent = "看着这段画面，你还记得怎么说吗？";
  $("#reviewProgress").textContent = dueWords.some((item) => item.id === word.id) ? "今天的待复习卡" : "刚收藏，马上复习一次";
  $(".review-actions").hidden = false;
  $("#reviewResult").hidden = true;
  $("#reviewPanel").classList.add("open");
  $("#reviewPanel").setAttribute("aria-hidden", "false");
}

function closeReview() {
  const completed = !$("#reviewResult").hidden;
  $("#reviewPanel").classList.remove("open");
  $("#reviewPanel").setAttribute("aria-hidden", "true");
  if (completed) {
    reviewTarget = null;
    updateLibraryUI();
  }
}

async function submitReview(action) {
  if (!reviewTarget?.id) return;
  $$(".review-actions button").forEach((button) => button.disabled = true);
  try {
    const response = await apiFetch("/api/review", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reviewTarget.id, action })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "复习记录失败");
    $("#reviewAnswer").textContent = reviewTarget.text;
    $("#reviewExample").hidden = !reviewTarget.detail?.context;
    $("#reviewTranslation").hidden = !reviewTarget.detail?.translation;
    $("#reviewFeedback").textContent = action === "remember"
      ? `记住了：${reviewTarget.text}。这张画面会在 ${payload.next_review_in_days} 天后再次出现。`
      : `答案是 ${reviewTarget.text}。没关系，这张画面明天会再来一次。`;
    $(".review-actions").hidden = true;
    $("#reviewResult").hidden = false;
    dueWords = dueWords.filter((word) => word.id !== reviewTarget.id);
    libraryWords = libraryWords.map((word) => word.id === reviewTarget.id ? { ...word, ...payload.word } : word);
    persistLibraryCache();
    updateLibraryUI();
  } catch (error) {
    showToast("复习结果暂时没保存，请再试一次");
  } finally {
    $$(".review-actions button").forEach((button) => button.disabled = false);
  }
}

function speakText(text, label) {
  if (!text || !("speechSynthesis" in window)) {
    showToast("当前浏览器不支持系统朗读");
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = languageConfig[currentLang].locale;
  utterance.rate = .84;
  utterance.onerror = () => {
    duckAmbient(false);
    showToast("当前设备不支持该语言发音");
  };
  utterance.onstart = () => {
    duckAmbient(true);
    showToast(`正在朗读${label}`);
  };
  utterance.onend = () => duckAmbient(false);
  speechSynthesis.speak(utterance);
}

function speakCurrentWord() {
  if (!currentItem) return;
  speakText(currentItem.text, "单词");
}

function speakCurrentExample() {
  if (!currentItem?.detail?.context) return showToast("例句生成后即可朗读");
  speakText(currentItem.detail.context, "画面例句");
}

function speakContextLookup() {
  if (!contextLookup?.text) return;
  speakText(contextLookup.text, "句中词");
}

function speakReviewAnswer() {
  if (!reviewTarget?.text) return;
  const language = reviewTarget.language;
  const previousLanguage = currentLang;
  if (languageConfig[language]) currentLang = language;
  speakText(reviewTarget.text, "词卡答案");
  currentLang = previousLanguage;
}

function speakReviewExample() {
  if (!reviewTarget?.detail?.context) return showToast("这张词卡还没有例句");
  const previousLanguage = currentLang;
  if (languageConfig[reviewTarget.language]) currentLang = reviewTarget.language;
  speakText(reviewTarget.detail.context, "词卡例句");
  currentLang = previousLanguage;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function selectLanguage(lang) {
  if (!languageConfig[lang] || lang === currentLang) {
    languageMenu.classList.remove("open");
    return;
  }
  currentLang = lang;
  $("#languageLabel").textContent = languageConfig[lang].label;
  $$("#languageMenu button").forEach((button) => {
    button.querySelector("i").textContent = button.dataset.lang === lang ? "✓" : "";
  });
  languageMenu.classList.remove("open");
  showToast(`已切换为${languageConfig[lang].name}`);
  if (isPaused) loadLanguageResult();
}

function selectLevel(level) {
  if (!levelConfig[level] || level === currentLevel) {
    $("#levelMenu").classList.remove("open");
    return;
  }
  currentLevel = level;
  localStorage.setItem(STORAGE_LEVEL, level);
  $("#levelLabel").textContent = levelConfig[level].label;
  $$("#levelMenu button").forEach((button) => {
    button.querySelector("i").textContent = button.dataset.level === level ? "✓" : "";
  });
  $("#levelMenu").classList.remove("open");
  showToast(`已切换为${levelConfig[level].name}难度`);
  if (isPaused) loadLanguageResult();
}

function updateTimeline() {
  if (sceneVideo.hidden || mediaMode === "camera") return;
  const ratio = sceneVideo.duration ? sceneVideo.currentTime / sceneVideo.duration : 0;
  $("#timeline").value = Math.round(ratio * 1000);
  $("#timeline").style.setProperty("--progress", `${ratio * 100}%`);
  $("#currentTime").textContent = formatTime(sceneVideo.currentTime);
}

scene.addEventListener("click", (event) => {
  if (event.target.closest("a, button, input, .language-menu, .word-sheet, .learning-toolbar, .player-controls, .library-panel, .review-panel")) return;
  if (!isPaused) pauseAndAnalyze();
});
$("#pauseButton").addEventListener("click", pauseAndAnalyze);
$("#continueButton").addEventListener("click", continuePlaying);
$("#retryAnalysis").addEventListener("click", () => loadLanguageResult(true));
$("#uploadButton").addEventListener("click", requestUpload);
$("#cameraButton").addEventListener("click", requestCamera);
$("#flipCamera").addEventListener("click", switchCamera);
$("#replaceButton").addEventListener("click", requestUpload);
mediaInput.addEventListener("change", () => {
  loadVideo(mediaInput.files[0]);
  mediaInput.value = "";
});

$("#languageButton").addEventListener("click", (event) => {
  event.stopPropagation();
  $("#levelMenu").classList.remove("open");
  languageMenu.classList.toggle("open");
});
$$("#languageMenu button").forEach((button) => button.addEventListener("click", () => selectLanguage(button.dataset.lang)));
$("#levelButton").addEventListener("click", (event) => {
  event.stopPropagation();
  languageMenu.classList.remove("open");
  $("#levelMenu").classList.toggle("open");
});
$$("#levelMenu button").forEach((button) => button.addEventListener("click", () => selectLevel(button.dataset.level)));
document.addEventListener("click", (event) => {
  if (!event.target.closest("#languageMenu, #languageButton")) languageMenu.classList.remove("open");
  if (!event.target.closest("#levelMenu, #levelButton")) $("#levelMenu").classList.remove("open");
});
$("#muteButton").addEventListener("click", toggleSound);
$("#timeline").addEventListener("input", (event) => {
  if (!sceneVideo.hidden && sceneVideo.duration) {
    sceneVideo.currentTime = (Number(event.target.value) / 1000) * sceneVideo.duration;
    updateTimeline();
  }
});
sceneVideo.addEventListener("timeupdate", updateTimeline);
sceneVideo.addEventListener("durationchange", () => $("#duration").textContent = formatTime(sceneVideo.duration));

$("#closeWordSheet").addEventListener("click", closeWordSheet);
$("#dismissWordSheet").addEventListener("click", closeWordSheet);
$("#saveWord").addEventListener("click", toggleSaveWord);
$("#blockWord").addEventListener("click", blockCurrentItem);
$("#speakWord").addEventListener("click", speakCurrentWord);
$("#speakExample").addEventListener("click", speakCurrentExample);
$("#closeContextExplorer").addEventListener("click", closeContextExplorer);
$("#speakContextWord").addEventListener("click", speakContextLookup);
$("#saveContextWord").addEventListener("click", saveContextLookup);
$("#retryContextLookup").addEventListener("click", () => openContextLookup(contextLookupTerm));
$("#contextText").addEventListener("pointerdown", (event) => {
  const token = event.target.closest(".context-token");
  if (!token) return;
  clearTimeout(contextPressTimer);
  contextPressTimer = setTimeout(() => {
    token.dataset.longPressed = "true";
    if (navigator.vibrate) navigator.vibrate(18);
    openContextLookup(token.dataset.term);
  }, 430);
});
$("#contextText").addEventListener("pointerup", () => clearTimeout(contextPressTimer));
$("#contextText").addEventListener("pointercancel", () => clearTimeout(contextPressTimer));
$("#contextText").addEventListener("pointerleave", () => clearTimeout(contextPressTimer));
$("#contextText").addEventListener("contextmenu", (event) => {
  if (event.target.closest(".context-token")) event.preventDefault();
});
$("#contextText").addEventListener("click", (event) => {
  const token = event.target.closest(".context-token");
  if (!token) return;
  if (token.dataset.longPressed === "true") {
    delete token.dataset.longPressed;
    return;
  }
  openContextLookup(token.dataset.term);
});
$("#collocations").addEventListener("click", (event) => {
  const button = event.target.closest("[data-term]");
  if (button) openContextLookup(button.dataset.term);
});
$("#retryDetail").addEventListener("click", () => {
  if (!currentItem) return;
  currentItem.detailLoading = false;
  openWordSheet(currentItem);
});
$("#blacklistButton").addEventListener("click", () => {
  renderBlacklist();
  $("#blacklistPanel").classList.add("open");
  $("#blacklistPanel").setAttribute("aria-hidden", "false");
});
$("#libraryButton").addEventListener("click", openLibrary);
$("#closeLibrary").addEventListener("click", closeLibrary);
$("#goSearch").addEventListener("click", closeLibrary);
$("#retryLibrary").addEventListener("click", loadLibrary);
$("#startReview").addEventListener("click", () => openReview(dueWords[0] || reviewTarget));
$("#closeReview").addEventListener("click", closeReview);
$("#reviewRemember").addEventListener("click", () => submitReview("remember"));
$("#reviewAgain").addEventListener("click", () => submitReview("again"));
$("#reviewSpeak").addEventListener("click", speakReviewAnswer);
$("#reviewSpeakExample").addEventListener("click", speakReviewExample);
$("#reviewFinish").addEventListener("click", closeReview);
$("#closeBlacklist").addEventListener("click", () => {
  $("#blacklistPanel").classList.remove("open");
  $("#blacklistPanel").setAttribute("aria-hidden", "true");
});
$("#clearBlacklist").addEventListener("click", () => {
  saveBlacklist([]);
  renderBlacklist();
  const result = currentFrame?.results[`${currentLang}:${currentLevel}`];
  if (isPaused && result) renderResult(result);
  showToast("已恢复全部学习点");
});

$("#logoutButton").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_SESSION);
  learningSession = null;
  accountReady = null;
  $("#logoutButton").hidden = true;
  showToast("已重置本机学习账户");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if ($("#reviewPanel").classList.contains("open")) closeReview();
    else if ($("#libraryPanel").classList.contains("open")) closeLibrary();
    else if (wordSheet.classList.contains("open")) closeWordSheet();
    return;
  }
  const interactive = event.target.closest("input, textarea, select, button");
  if (event.code !== "Space" || interactive) return;
  event.preventDefault();
  if (isPaused) continuePlaying();
  else pauseAndAnalyze();
});

$("#logoutButton").hidden = true;
updateSoundUI();
$("#levelLabel").textContent = levelConfig[currentLevel].label;
$$("#levelMenu button").forEach((button) => {
  button.querySelector("i").textContent = button.dataset.level === currentLevel ? "✓" : "";
});
updateBlacklistUI();
updateTimeline();
restoreLibraryCache();
ensureLearningSession().then(() => loadLibrary()).catch(() => {
  const recovered = restoreLibraryCache();
  $("#libraryCount").textContent = recovered ? libraryWords.length : "!";
  setLibraryState(recovered ? "cached" : "error");
});
document.addEventListener("pointerdown", () => startAmbient().catch(() => {}), { once: true, capture: true });
window.addEventListener("pagehide", stopCamera);
