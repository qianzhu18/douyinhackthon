const $ = (selector) => document.querySelector(selector);

const STORAGE_WORDS = "frame-language-words";
const kindLabels = { noun: "名词", person: "人物", verb: "动作", phrase: "场景表达" };
const langLabels = { en: "EN", ja: "JP", ko: "KO" };

let words = [];
let queue = [];
let queueIndex = 0;
let revealed = false;

function loadWords() {
  try {
    const values = JSON.parse(localStorage.getItem(STORAGE_WORDS) || "[]");
    words = Array.isArray(values) ? values : [];
  } catch {
    words = [];
  }
}

function saveWords() {
  localStorage.setItem(STORAGE_WORDS, JSON.stringify(words));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function dueWords() {
  return words.filter((word) => !word.known);
}

function sceneKey(word) {
  return word.scene || word.source || "未命名画面";
}

function renderStats() {
  const due = dueWords();
  const scenes = new Set(words.map(sceneKey));
  $("#statDue").textContent = due.length;
  $("#statTotal").textContent = words.length;
  $("#statScenes").textContent = scenes.size;
  const start = $("#reviewStart");
  start.disabled = due.length === 0;
  start.innerHTML = due.length
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
  $("#sceneGroups").innerHTML = [...groups.entries()].map(([scene, list]) => {
    const cover = list.find((word) => word.frame);
    const figure = cover
      ? `<img src="${cover.frame}" alt="${escapeHtml(scene)}" loading="lazy" />`
      : `<div class="no-frame">帧</div>`;
    const chips = list.map((word) => `
      <button class="word-chip ${word.known ? "known" : ""}" data-key="${escapeHtml(word.key)}">
        <b>${escapeHtml(word.text)}</b><small>${escapeHtml(word.meaning)} · ${escapeHtml(word.cefr)}</small>
      </button>
    `).join("");
    return `
      <article class="scene-group">
        <figure>${figure}<figcaption>${escapeHtml(scene)}</figcaption></figure>
        <div class="scene-words">
          <h3>${escapeHtml(list[0].source || "这段画面")}<small>${list.length} 个表达 · ${langLabels[list[0].language] || ""}</small></h3>
          <div class="word-chips">${chips}</div>
        </div>
      </article>
    `;
  }).join("");
  document.querySelectorAll(".word-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const word = words.find((item) => item.key === chip.dataset.key);
      if (!word) return;
      word.known = !word.known;
      saveWords();
      renderStats();
      renderGroups();
    });
  });
}

function renderReview() {
  const word = queue[queueIndex];
  revealed = false;
  $("#reviewProgress").textContent = `${queueIndex + 1} / ${queue.length}`;
  $("#reviewImage").src = word.frame || "/cafe-scene.jpg";
  $("#reviewScene").textContent = word.scene ? `场景提示：${word.scene}` : "想想这一帧里你收藏的表达";
  $("#reviewPrompt").textContent = "你还记得这个表达吗？";
  $("#reviewAnswer").hidden = true;
  $("#reviewReveal").hidden = false;
  $("#reviewReveal").textContent = "显示表达";
  $("#reviewGrade").hidden = true;
}

function revealAnswer() {
  const word = queue[queueIndex];
  revealed = true;
  $("#reviewWord").textContent = word.text;
  $("#reviewMeta").textContent = `${word.cefr} · ${kindLabels[word.kind] || "表达"}`;
  $("#reviewMeaning").textContent = word.meaning;
  $("#reviewAnswer").hidden = false;
  $("#reviewReveal").hidden = true;
  $("#reviewGrade").hidden = false;
}

function grade(known) {
  const word = queue[queueIndex];
  const stored = words.find((item) => item.key === word.key);
  if (stored) {
    stored.reviews = Number(stored.reviews || 0) + 1;
    if (known) stored.known = true;
    saveWords();
  }
  word._passes = Number(word._passes || 0) + 1;
  if (!known && word._passes < 3) queue.push(word);
  queueIndex++;
  if (queueIndex >= queue.length) {
    finishReview();
  } else {
    renderReview();
  }
}

function finishReview() {
  $("#reviewCard").hidden = true;
  $("#reviewDone").hidden = false;
  $("#reviewProgress").textContent = "完成";
}

function startReview() {
  queue = dueWords().sort((a, b) => Number(a.reviews || 0) - Number(b.reviews || 0));
  if (!queue.length) return;
  queueIndex = 0;
  $("#reviewCard").hidden = false;
  $("#reviewDone").hidden = true;
  $("#reviewMode").classList.add("open");
  $("#reviewMode").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderReview();
}

function exitReview() {
  $("#reviewMode").classList.remove("open");
  $("#reviewMode").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  renderStats();
  renderGroups();
}

loadWords();
if (words.length) {
  $("#libContent").hidden = false;
  renderStats();
  renderGroups();
} else {
  $("#libEmpty").hidden = false;
}

$("#reviewStart").addEventListener("click", startReview);
$("#reviewExit").addEventListener("click", exitReview);
$("#reviewReveal").addEventListener("click", revealAnswer);
$("#gradeKnown").addEventListener("click", () => grade(true));
$("#gradeAgain").addEventListener("click", () => grade(false));
