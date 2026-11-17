(function () {
  "use strict";

  const OPTIONS_URL = "options.json";
  const EXTENSIONS = [".gif", ".png"]; // 沒寫副檔名時依序嘗試
  const DEFAULT_LOADING_MS = 1200;
  const DRAG_THRESHOLD = 6;            // 手指移動超過幾 px 才算開始拖曳

  const el = {
    stage: document.getElementById("stage"),
    idle: document.getElementById("stage-idle"),
    dropzone: document.getElementById("dropzone"),
    loading: document.getElementById("stage-loading"),
    img: document.getElementById("stage-img"),
    restart: document.getElementById("restart"),
    options: document.getElementById("options"),
  };

  const state = {
    items: [],
    loadingMs: DEFAULT_LOADING_MS,
    mode: "idle",   // idle | loading | result
    itemId: null,
    token: 0,       // 避免連續拖放時舊的流程蓋掉新的
  };

  /* ---------- 圖片載入（GIF / PNG） ---------- */

  const resolved = {}; // image 設定 -> 找到的路徑（或 null = 找不到）

  function candidates(path) {
    if (!path) return [];
    return /\.(gif|png)$/i.test(path) ? [path] : EXTENSIONS.map((ext) => path + ext);
  }

  function tryLoad(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  async function resolveImage(path) {
    if (path in resolved) return resolved[path];
    let found = null;
    for (const src of candidates(path)) {
      if (await tryLoad(src)) { found = src; break; }
    }
    resolved[path] = found;
    return found;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- 上方畫面狀態 ---------- */

  function setMode(mode) {
    state.mode = mode;
    el.idle.hidden = mode !== "idle";
    el.loading.hidden = mode !== "loading";
    el.img.hidden = mode !== "result" || !el.img.getAttribute("src");
    el.restart.hidden = mode !== "result";
  }

  function reset() {
    state.token++;
    state.itemId = null;
    markActive(null);
    el.img.removeAttribute("src");
    setMode("idle");
  }

  // 拖放成功：播放載入動畫 → 顯示對應圖片
  async function applyItem(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    const token = ++state.token;
    state.itemId = itemId;
    markActive(itemId);

    // 重新觸發載入動畫
    el.loading.hidden = true;
    void el.loading.offsetWidth;
    setMode("loading");

    const [src] = await Promise.all([resolveImage(item.image), wait(state.loadingMs)]);
    if (token !== state.token) return;

    // 每次換一個新的 <img>：保證 GIF 從第一幀播放，也會重新觸發彈出動畫
    const fresh = el.img.cloneNode(false);
    if (src) {
      fresh.src = src;
      fresh.alt = item.name;
    } else {
      fresh.removeAttribute("src"); // 找不到資源：什麼都不顯示
    }
    el.img.replaceWith(fresh);
    el.img = fresh;
    setMode("result");
  }

  function markActive(itemId) {
    el.options.querySelectorAll(".option").forEach((node) => {
      node.classList.toggle("is-active", node.dataset.id === itemId);
    });
  }

  /* ---------- 下方選項 ---------- */

  function renderOptions() {
    el.options.innerHTML = "";
    state.items.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = "option";
      btn.dataset.id = item.id;
      btn.setAttribute("role", "option");
      btn.textContent = item.name;
      btn.addEventListener("pointerdown", (e) => startPress(e, item, btn));
      el.options.appendChild(btn);
      resolveImage(item.image); // 預載
    });
  }

  /* ---------- 拖曳（pointer 事件，手機觸控 / 滑鼠都可用） ---------- */

  let drag = null;

  // 目前可以放下的目標：待機時是虛線框；已有結果時整個上方區域都可以
  function dropTarget() {
    if (state.mode === "idle") return el.dropzone;
    if (state.mode === "result") return el.stage;
    return null; // 載入中不接受
  }

  function isOver(target, x, y) {
    if (!target) return false;
    const r = target.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function startPress(e, item, btn) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    if (drag) endDrag(false); // 上一次拖曳沒正常結束的話先清掉
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    drag = { item, btn, id: e.pointerId, x0: e.clientX, y0: e.clientY, ghost: null, over: false };
    // 監聽整個視窗，手指移出按鈕或 capture 遺失也收得到放開事件
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    btn.addEventListener("lostpointercapture", onEnd);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { clientX: x, clientY: y } = e;

    if (!drag.ghost) {
      if (Math.hypot(x - drag.x0, y - drag.y0) < DRAG_THRESHOLD) return;
      drag.ghost = document.createElement("div");
      drag.ghost.className = "drag-ghost";
      drag.ghost.textContent = drag.item.name;
      document.body.appendChild(drag.ghost);
      drag.btn.classList.add("is-dragging");
      if (state.mode === "idle") el.dropzone.classList.add("is-ready");
    }
    drag.ghost.style.left = x + "px";
    drag.ghost.style.top = y + "px";

    const target = dropTarget();
    drag.over = isOver(target, x, y);
    el.dropzone.classList.toggle("is-over", drag.over && target === el.dropzone);
    el.stage.classList.toggle("is-over", drag.over && target === el.stage);
  }

  function onEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.type === "pointerup" || e.type === "lostpointercapture") {
      // 放開位置以事件座標為準（lostpointercapture 沒有可靠座標，沿用最後一次判斷）
      if (e.type === "pointerup" && drag.ghost) drag.over = isOver(dropTarget(), e.clientX, e.clientY);
      endDrag(true);
    } else {
      endDrag(false); // pointercancel：取消
    }
  }

  function endDrag(allowDrop) {
    const { btn, ghost, item } = drag;
    const dropped = allowDrop && ghost && drag.over;

    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
    btn.removeEventListener("lostpointercapture", onEnd);
    btn.classList.remove("is-dragging");
    if (ghost) ghost.remove();
    el.dropzone.classList.remove("is-ready", "is-over");
    el.stage.classList.remove("is-over");
    drag = null;

    if (dropped) applyItem(item.id);
  }

  el.restart.addEventListener("click", reset);

  /* ---------- 讀取 options.json ---------- */

  async function loadOptions(url = OPTIONS_URL) {
    try {
      // no-cache：每次都向伺服器確認，改完 JSON 重新整理就會生效
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.items = Array.isArray(data.items) ? data.items : [];
      state.loadingMs = Number.isFinite(data.loadingMs) ? data.loadingMs : DEFAULT_LOADING_MS;
    } catch (err) {
      console.error(`無法讀取 ${url}：`, err);
      state.items = [];
    }
    renderOptions();
    reset();
  }

  loadOptions();

  // 對外開放：App.applyItem("rabbit") 直接套用、App.reset() 回到待機、App.loadOptions("other.json")
  window.App = { applyItem, reset, loadOptions, state };
})();
