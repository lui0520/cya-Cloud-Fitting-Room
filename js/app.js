/**
 * 合成表由 options.json 控制：
 * {
 *   "loadingMs": 1200,                       // 按「合成」後，載入動畫播放多久（毫秒）
 *   "materials": [                           // 下方可拖曳的材料
 *     { "id": "rabbit", "name": "兔子", "icon": "icons/rabbit" }
 *   ],
 *   "recipes": [                             // 合成表
 *     { "materials": ["rabbit"],                  "name": "兔子",  "image": "assets/rabbit.png" },
 *     { "materials": ["rabbit", "rabbit", "cat"], "name": "兔兔貓", "image": "assets/xxx.png" }
 *   ]
 * }
 * - variants：機率結果，例如 [{ "name": "吃栗子", "image": "assets/eat_chestnut.png", "chance": 0.3 }]
 *             chance 是 0～1（0.3 = 30%），沒抽中就顯示配方本身的 name/image
 * - 每個配方需要 1～3 個材料，材料可以重複（同一個 id 寫兩次 = 需要兩個）
 * - 合成無序：["cat", "rabbit"] 跟 ["rabbit", "cat"] 是同一個配方
 * - 材料數量也要相符：放了 ["rabbit", "rabbit"] 不會符合 ["rabbit"]
 * - image：GIF 或 PNG 都可以；不寫副檔名時依序找 .gif、.png；找不到就什麼都不顯示
 * - icon：材料貼圖（放在 icons/ 資料夾），規則同 image；沒寫時預設找 icons/<材料 id>；
 *         找不到貼圖時只顯示材料名稱
 *
 * 流程：待機（材料框 3 格 + 雲朵）→ 把下方材料拖進材料框（點格子可移除）
 *       → 按「合成」→ 載入動畫 → 顯示配方結果圖片
 *       合成表沒有這個組合時，材料框會搖晃，不會進入載入。
 */
(function () {
  "use strict";

  const OPTIONS_URL = "options.json";
  const ICON_DIR = "icons/";           // 材料貼圖資料夾（材料沒寫 icon 時的預設位置）
  const EXTENSIONS = [".gif", ".png"]; // 沒寫副檔名時依序嘗試
  const DEFAULT_LOADING_MS = 1200;
  const MAX_SLOTS = 3;
  const DRAG_THRESHOLD = 6;            // 手指移動超過幾 px 才算開始拖曳

  const el = {
    stage: document.getElementById("stage"),
    idle: document.getElementById("stage-idle"),
    dropzone: document.getElementById("dropzone"),
    slots: [...document.querySelectorAll(".slot")],
    craft: document.getElementById("craft"),
    loading: document.getElementById("stage-loading"),
    img: document.getElementById("stage-img"),
    restart: document.getElementById("restart"),
    options: document.getElementById("options"),
  };

  const state = {
    materials: [],
    recipes: {},    // 排序後的材料 key -> 配方
    loadingMs: DEFAULT_LOADING_MS,
    mode: "idle",   // idle | loading | result
    slots: [],      // 目前放進材料框的材料 id（最多 3 個，可重複）
    result: null,   // 目前顯示的配方
    token: 0,       // 避免連續操作時舊的流程蓋掉新的
  };

  /* ---------- 合成表 ---------- */

  // 無序：排序後串起來當 key，["cat","rabbit"] 與 ["rabbit","cat"] 會得到同一個 key
  const recipeKey = (ids) => [...ids].sort().join("+");

  function buildRecipes(list) {
    const map = {};
    (Array.isArray(list) ? list : []).forEach((r, i) => {
      const mats = Array.isArray(r.materials) ? r.materials : [];
      if (mats.length < 1 || mats.length > MAX_SLOTS) {
        console.warn(`合成表第 ${i + 1} 筆需要 1～${MAX_SLOTS} 個材料，已略過：`, r);
        return;
      }
      const key = recipeKey(mats);
      if (map[key]) console.warn(`合成表第 ${i + 1} 筆與前面的配方材料相同，以後面的為準：`, r);
      map[key] = r;
    });
    return map;
  }

  const findRecipe = (ids) => state.recipes[recipeKey(ids)] || null;

  // 機率結果：配方可以有 "variants"，每個有 chance（0～1）；都沒抽中就用配方本身的 name/image
  // 例：{ "materials": ["chestnut"], "name": "栗子", "image": "assets/chestnut.png",
  //       "variants": [{ "name": "吃栗子", "image": "assets/eat_chestnut.png", "chance": 0.3 }] }
  function pickOutcome(recipe, roll = Math.random()) {
    let acc = 0;
    for (const v of Array.isArray(recipe.variants) ? recipe.variants : []) {
      acc += Number(v.chance) || 0;
      if (roll < acc) return v;
    }
    return recipe;
  }
  const getMaterial = (id) => state.materials.find((m) => m.id === id) || { id, name: id };
  const materialName = (id) => getMaterial(id).name;
  const iconPath = (m) => m.icon || ICON_DIR + m.id;

  // 材料的「貼圖 + 名稱」內容；貼圖找到後才插入，找不到就只有名稱
  function materialContent(m) {
    const frag = document.createDocumentFragment();
    const img = document.createElement("img");
    img.className = "mat-icon";
    img.alt = "";
    img.draggable = false;
    img.hidden = true;
    const name = document.createElement("span");
    name.className = "mat-name";
    name.textContent = m.name;
    frag.append(img, name);
    // 檔案中途被刪除或讀取失敗：移除貼圖只留名稱，並清掉快取讓下次重新找
    img.onerror = () => { img.remove(); delete resolved[iconPath(m)]; };
    resolveImage(iconPath(m)).then((src) => {
      if (src) { img.src = src; img.hidden = false; }
      else img.remove();
    });
    return frag;
  }

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
    if (!path) return null;
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

  function renderSlots() {
    el.slots.forEach((slot, i) => {
      const id = state.slots[i];
      slot.replaceChildren(id ? materialContent(getMaterial(id)) : "");
      slot.classList.toggle("is-filled", !!id);
      slot.setAttribute("aria-label", id ? `移除 ${materialName(id)}` : "空的材料格");
    });
    el.dropzone.classList.toggle("is-full", state.slots.length >= MAX_SLOTS);
    el.craft.disabled = state.slots.length === 0;
  }

  // 回到待機並清空材料
  function reset() {
    state.token++;
    state.slots = [];
    state.result = null;
    el.img.removeAttribute("src");
    renderSlots();
    setMode("idle");
  }

  function addMaterial(id) {
    if (state.mode !== "idle" || state.slots.length >= MAX_SLOTS) return false;
    state.slots.push(id);
    renderSlots();
    return true;
  }

  function removeSlot(index) {
    if (state.mode !== "idle" || index >= state.slots.length) return;
    state.slots.splice(index, 1);
    renderSlots();
  }

  function shake() {
    el.dropzone.classList.remove("is-shake");
    void el.dropzone.offsetWidth;
    el.dropzone.classList.add("is-shake");
  }

  // 按「合成」：查合成表 → 載入動畫 → 顯示結果
  async function craft() {
    if (state.mode !== "idle" || state.slots.length === 0) return;
    const recipe = findRecipe(state.slots);
    if (!recipe) { shake(); return null; } // 合成表沒有這個組合

    const token = ++state.token;
    const outcome = pickOutcome(recipe);
    state.result = outcome;

    // 重新觸發載入動畫
    el.loading.hidden = true;
    void el.loading.offsetWidth;
    setMode("loading");

    const [src] = await Promise.all([resolveImage(outcome.image), wait(state.loadingMs)]);
    if (token !== state.token) return outcome;

    // 每次換一個新的 <img>：保證 GIF 從第一幀播放，也會重新觸發彈出動畫
    const fresh = el.img.cloneNode(false);
    if (src) {
      fresh.src = src;
      fresh.alt = outcome.name || "";
    } else {
      fresh.removeAttribute("src"); // 找不到資源：什麼都不顯示
    }
    el.img.replaceWith(fresh);
    el.img = fresh;
    setMode("result");
    return outcome;
  }

  el.craft.addEventListener("click", craft);
  el.restart.addEventListener("click", reset);
  el.slots.forEach((slot, i) => slot.addEventListener("click", () => removeSlot(i)));

  /* ---------- 下方材料 ---------- */

  function renderOptions() {
    el.options.innerHTML = "";
    state.materials.forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "option";
      btn.dataset.id = m.id;
      btn.setAttribute("role", "option");
      btn.append(materialContent(m));
      btn.addEventListener("pointerdown", (e) => startPress(e, m, btn));
      el.options.appendChild(btn);
    });
  }

  /* ---------- 拖曳（pointer 事件，手機觸控 / 滑鼠都可用） ---------- */

  let drag = null;

  // 目前可以放下的目標：待機且還有空格時是材料框；顯示結果時整個上方區域都可以（會重新開始）
  function dropTarget() {
    if (state.mode === "idle") return state.slots.length < MAX_SLOTS ? el.dropzone : null;
    if (state.mode === "result") return el.stage;
    return null; // 載入中不接受
  }

  function isOver(target, x, y) {
    if (!target) return false;
    const r = target.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function startPress(e, material, btn) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    if (drag) endDrag(false); // 上一次拖曳沒正常結束的話先清掉
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    drag = { material, btn, id: e.pointerId, x0: e.clientX, y0: e.clientY, ghost: null, over: false };
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
      drag.ghost.append(materialContent(drag.material));
      document.body.appendChild(drag.ghost);
      drag.btn.classList.add("is-dragging");
      if (dropTarget() === el.dropzone) el.dropzone.classList.add("is-ready");
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
    const { btn, ghost, material } = drag;
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

    if (!dropped) return;
    if (state.mode === "result") reset(); // 結果畫面拖材料上來 = 重新開始並放入這個材料
    addMaterial(material.id);
  }

  /* ---------- 讀取 options.json ---------- */

  async function loadOptions(url = OPTIONS_URL) {
    try {
      // no-cache：每次都向伺服器確認，改完 JSON 重新整理就會生效
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // 相容舊格式："items" 也當成材料
      const list = data.materials || data.items;
      state.materials = Array.isArray(list) ? list : [];
      state.recipes = buildRecipes(data.recipes);
      state.loadingMs = Number.isFinite(data.loadingMs) ? data.loadingMs : DEFAULT_LOADING_MS;
      Object.values(state.recipes).forEach((r) => {                       // 預載結果圖（含機率結果）
        resolveImage(r.image);
        (Array.isArray(r.variants) ? r.variants : []).forEach((v) => resolveImage(v.image));
      });
    } catch (err) {
      console.error(`無法讀取 ${url}：`, err);
      state.materials = [];
      state.recipes = {};
    }
    renderOptions();
    reset();
  }

  loadOptions();

  // 對外開放：App.addMaterial("cat")、App.craft()、App.reset()、App.loadOptions("other.json")
  window.App = { addMaterial, removeSlot, craft, reset, loadOptions, findRecipe, pickOutcome, state };
})();
