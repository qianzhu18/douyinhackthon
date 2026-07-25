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
const STORAGE_WORDS = "frame-language-words";
const STORAGE_LEVEL = "frame-language-level";
const STORAGE_BLACKLIST = "frame-language-blacklist";
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
let mediaMode = "sample";
let isPaused = false;
let isAnalyzing = false;
let requestToken = 0;
let pendingAction = null;

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

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function getAccessCode() {
  return localStorage.getItem(STORAGE_ACCESS) || "";
}

function setAuthenticated(code) {
  localStorage.setItem(STORAGE_ACCESS, code);
  $("#logoutButton").hidden = false;
}

function openAuth() {
  $("#authModal").classList.add("open");
  $("#authModal").setAttribute("aria-hidden", "false");
  $("#authError").textContent = "";
  $("#accessCode").value = getAccessCode();
  setTimeout(() => $("#accessCode").focus(), 80);
}

function closeAuth() {
  $("#authModal").classList.remove("open");
  $("#authModal").setAttribute("aria-hidden", "true");
}

async function verifyAccess(code) {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `验证失败（${response.status}）`);
  return true;
}

function requestUpload() {
  if (!getAccessCode()) {
    pendingAction = "upload";
    openAuth();
    return;
  }
  mediaInput.click();
}

function requestCamera() {
  if (!getAccessCode()) {
    pendingAction = "camera";
    openAuth();
    return;
  }
  startCamera();
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  if (sceneVideo.srcObject) sceneVideo.srcObject = null;
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
  sceneVideo.muted = true;
  sceneVideo.loop = false;
  $("#muteLabel").textContent = "开启声音";
  $("#muteIcon").textContent = "♪";
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

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("当前浏览器或地址不支持摄像头");
    return;
  }
  try {
    stopCamera();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: { ideal: "environment" }
      },
      audio: false
    });
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
    $("#muteButton").hidden = true;
    $("#replaceButton").textContent = "选择视频";
    $("#welcomeTip b").textContent = "摄像头模式已开启";
    $("#welcomeTip small").textContent = "点击画面或按空格冻结当前帧";
    await sceneVideo.play();
  } catch (error) {
    stopCamera();
    const message = error.name === "NotAllowedError"
      ? "没有获得摄像头权限，请在浏览器设置中允许访问"
      : `摄像头启动失败：${error.message}`;
    showToast(message);
  }
}

function captureFrame() {
  const source = sceneVideo.hidden ? sceneImage : sceneVideo;
  const width = source.naturalWidth || source.videoWidth;
  const height = source.naturalHeight || source.videoHeight;
  if (!width || !height) throw new Error("视频画面尚未准备好");
  const scale = Math.min(1, 1024 / Math.max(width, height));
  frameCanvas.width = Math.max(1, Math.round(width * scale));
  frameCanvas.height = Math.max(1, Math.round(height * scale));
  frameCanvas.getContext("2d").drawImage(source, 0, 0, frameCanvas.width, frameCanvas.height);
  return frameCanvas.toDataURL("image/jpeg", .82);
}

function findNearbyFrame(time) {
  return frameHistory.find((frame) =>
    frame.mediaSession === mediaSession && Math.abs(frame.time - time) <= 1
  );
}

async function pauseAndAnalyze() {
  if (isPaused || isAnalyzing) return;
  if (!getAccessCode()) {
    openAuth();
    return;
  }
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
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Code": getAccessCode()
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
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem(STORAGE_ACCESS);
        $("#logoutButton").hidden = true;
      }
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
}

async function openWordSheet(item) {
  currentItem = item;
  $("#wordType").textContent = kindLabels[item.kind] || "EXPRESSION · 表达";
  $("#wordText").textContent = item.text;
  $("#phonetic").textContent = item.detail?.phonetic || "正在生成详情…";
  $("#meaningText").textContent = item.meaning;
  $("#contextText").textContent = item.detail?.context || "正在结合画面生成自然例句…";
  $("#translationText").textContent = item.detail?.translation || "请稍候";
  $("#collocations").innerHTML = item.detail
    ? item.detail.tags.map((tag) => `<button type="button">${escapeHtml(tag)}</button>`).join("")
    : "<button type=\"button\">生成常用搭配中…</button>";
  $("#saveWord").disabled = !item.detail;
  updateSaveButton();
  wordSheet.classList.add("open");
  wordSheet.setAttribute("aria-hidden", "false");
  if (item.detail || item.detailLoading) return;

  item.detailLoading = true;
  try {
    const result = currentFrame?.results[`${currentLang}:${currentLevel}`];
    const response = await fetch("/api/detail", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Code": getAccessCode()
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
    $("#contextText").textContent = payload.context;
    $("#translationText").textContent = payload.translation;
    $("#collocations").innerHTML = payload.tags
      .map((tag) => `<button type="button">${escapeHtml(tag)}</button>`).join("");
    $("#saveWord").disabled = false;
    updateSaveButton();
  } catch (error) {
    if (currentItem === item) {
      $("#phonetic").textContent = "详情生成失败";
      $("#contextText").textContent = error.message;
      $("#translationText").textContent = "再次点击该浮窗可以重试";
      $("#collocations").innerHTML = "";
    }
  } finally {
    item.detailLoading = false;
  }
}

function closeWordSheet() {
  wordSheet.classList.remove("open");
  wordSheet.setAttribute("aria-hidden", "true");
}

function getSavedWords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_WORDS) || "[]");
  } catch {
    return [];
  }
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
  const items = getBlacklist();
  if (!items.some((item) => item.concept === currentItem.concept)) {
    items.push({
      concept: currentItem.concept,
      text: currentItem.text,
      meaning: currentItem.meaning,
      blockedAt: Date.now()
    });
    saveBlacklist(items);
  }
  closeWordSheet();
  const result = currentFrame?.results[`${currentLang}:${currentLevel}`];
  if (result) renderResult(result);
  showToast(`“${currentItem.text}”以后不再出现`);
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
  return item ? `${currentLang}:${item.text.toLocaleLowerCase()}` : "";
}

function updateSaveButton() {
  const saved = getSavedWords().some((word) => word.key === wordKey());
  $("#saveWord").classList.toggle("saved", saved);
  $("#saveWord").textContent = saved ? "✓ 已收藏" : "＋ 收藏";
}

function toggleSaveWord() {
  if (!currentItem) return;
  const words = getSavedWords();
  const key = wordKey();
  const index = words.findIndex((word) => word.key === key);
  if (index >= 0) {
    words.splice(index, 1);
    showToast("已取消收藏");
  } else {
    words.push({ key, language: currentLang, savedAt: Date.now(), ...currentItem, detailLoading: undefined });
    showToast("已加入本地生词本");
  }
  localStorage.setItem(STORAGE_WORDS, JSON.stringify(words));
  updateSaveButton();
}

function speakCurrentWord() {
  if (!currentItem || !("speechSynthesis" in window)) {
    showToast("当前浏览器不支持系统朗读");
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(currentItem.text);
  utterance.lang = languageConfig[currentLang].locale;
  utterance.rate = .84;
  utterance.onerror = () => showToast("当前设备不支持该语言发音");
  speechSynthesis.speak(utterance);
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
  if (event.target.closest("button, input, .language-menu, .word-sheet, .learning-toolbar, .player-controls")) return;
  if (!isPaused) pauseAndAnalyze();
});
$("#pauseButton").addEventListener("click", pauseAndAnalyze);
$("#continueButton").addEventListener("click", continuePlaying);
$("#retryAnalysis").addEventListener("click", () => loadLanguageResult(true));
$("#uploadButton").addEventListener("click", requestUpload);
$("#cameraButton").addEventListener("click", requestCamera);
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
$("#muteButton").addEventListener("click", () => {
  if (sceneVideo.hidden || mediaMode === "camera") return showToast("当前模式没有声音");
  sceneVideo.muted = !sceneVideo.muted;
  $("#muteLabel").textContent = sceneVideo.muted ? "开启声音" : "关闭声音";
  $("#muteIcon").textContent = sceneVideo.muted ? "♪" : "♫";
});
$("#timeline").addEventListener("input", (event) => {
  if (!sceneVideo.hidden && sceneVideo.duration) {
    sceneVideo.currentTime = (Number(event.target.value) / 1000) * sceneVideo.duration;
    updateTimeline();
  }
});
sceneVideo.addEventListener("timeupdate", updateTimeline);
sceneVideo.addEventListener("durationchange", () => $("#duration").textContent = formatTime(sceneVideo.duration));

$("#closeWordSheet").addEventListener("click", closeWordSheet);
$("#saveWord").addEventListener("click", toggleSaveWord);
$("#blockWord").addEventListener("click", blockCurrentItem);
$("#speakWord").addEventListener("click", speakCurrentWord);
$("#blacklistButton").addEventListener("click", () => {
  renderBlacklist();
  $("#blacklistPanel").classList.add("open");
  $("#blacklistPanel").setAttribute("aria-hidden", "false");
});
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

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = $("#accessCode").value.trim();
  if (!code) return;
  $("#authSubmit").disabled = true;
  $("#authSubmit").textContent = "正在验证…";
  $("#authError").textContent = "";
  try {
    await verifyAccess(code);
    setAuthenticated(code);
    closeAuth();
    showToast("体验码验证成功");
    if (pendingAction === "upload") {
      pendingAction = null;
      mediaInput.click();
    } else if (pendingAction === "camera") {
      pendingAction = null;
      startCamera();
    }
  } catch (error) {
    $("#authError").textContent = error.message;
  } finally {
    $("#authSubmit").disabled = false;
    $("#authSubmit").textContent = "进入体验";
  }
});
$("#authClose").addEventListener("click", () => {
  pendingAction = null;
  closeAuth();
});
$("#logoutButton").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_ACCESS);
  $("#logoutButton").hidden = true;
  showToast("已退出体验");
});

document.addEventListener("keydown", (event) => {
  const interactive = event.target.closest("input, textarea, select, button");
  if (event.code !== "Space" || interactive || $("#authModal").classList.contains("open")) return;
  event.preventDefault();
  if (isPaused) continuePlaying();
  else pauseAndAnalyze();
});

$("#logoutButton").hidden = !getAccessCode();
$("#levelLabel").textContent = levelConfig[currentLevel].label;
$$("#levelMenu button").forEach((button) => {
  button.querySelector("i").textContent = button.dataset.level === currentLevel ? "✓" : "";
});
updateBlacklistUI();
updateTimeline();
window.addEventListener("pagehide", stopCamera);
