// ===== popup.js (최종본: 후보 미표시, 확정 시만 표시/적용) =====
let companyMap = {};

async function loadCompanyMap() {
  try {
    const res = await fetch(chrome.runtime.getURL("companymap.json"));
    companyMap = await res.json();
    console.log("[popup] companyMap loaded", Object.keys(companyMap).length);

    const inp = document.getElementById("companyInput");
    autocomplete(inp, Object.keys(companyMap)); // 자동완성 초기화
  } catch (e) {
    console.error("[popup] failed to load companymap.json", e);
  }
}

const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();

async function sendToContent(type, payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // content.js 존재 확인(PING)
  let has = true;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "PING" });
  } catch {
    has = false;
  }
  if (!has) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content.js"],
    });
  }
  await chrome.tabs.sendMessage(tab.id, { type, payload });
}

function applyToRedmine(company, productType) {
  return sendToContent("APPLY_COMPANY", { company, productType });
}

// ───────────────── 자동완성 (앞글자 일치, 적용은 절대 안 함) ─────────────────
function autocomplete(inp, arr) {
  let currentFocus = -1;

  inp.addEventListener("input", function () {
    clearResult(); // ★ 후보는 표시하지 않음
    closeAll();
    const val = this.value;
    if (!val) return;

    const box = document.createElement("DIV");
    box.setAttribute("id", this.id + "autocomplete-list");
    box.setAttribute("class", "autocomplete-items");
    this.parentNode.appendChild(box);

    const v = val.toLowerCase();
    const matches = arr
      .filter((x) => x.toLowerCase().startsWith(v))
      .slice(0, 10);

    matches.forEach((name) => {
      const d = document.createElement("DIV");
      d.innerHTML = `<strong>${name.substr(
        0,
        val.length
      )}</strong>${name.substr(val.length)}`;
      d.innerHTML += `<input type="hidden" value="${name}">`;

      // ★ 클릭: 입력창만 채움. 적용/표시는 하지 않음.
      d.addEventListener("click", () => {
        inp.value = name;
        closeAll();
        clearResult();
      });

      box.appendChild(d);
    });

    currentFocus = -1;
  });

  inp.addEventListener("keydown", (e) => {
    const list = document.getElementById(inp.id + "autocomplete-list");
    const items = list ? list.getElementsByTagName("div") : [];

    if (e.key === "ArrowDown") {
      currentFocus++;
      addActive(items);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      currentFocus--;
      addActive(items);
      e.preventDefault();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (currentFocus > -1 && items[currentFocus]) {
        // 하이라이트된 항목을 입력창에 반영
        const name = items[currentFocus].querySelector("input").value;
        inp.value = name;
        closeAll();
      }
      // ★ Enter로만 실제 적용 시도 (명시적 확정)
      resolveAndApply(true);
    }
  });

  function addActive(items) {
    if (!items.length) return;
    [...items].forEach((i) => i.classList.remove("autocomplete-active"));
    if (currentFocus >= items.length) currentFocus = 0;
    if (currentFocus < 0) currentFocus = items.length - 1;
    const item = items[currentFocus];
    item.classList.add("autocomplete-active");

    const container = document.getElementById(inp.id + "autocomplete-list");
    if (!container) return;
    const top = item.offsetTop,
      bottom = top + item.offsetHeight;
    const viewTop = container.scrollTop,
      viewBottom = viewTop + container.clientHeight;
    if (top < viewTop) container.scrollTop = top;
    else if (bottom > viewBottom)
      container.scrollTop = bottom - container.clientHeight;
  }

  function closeAll(el) {
    const boxes = document.getElementsByClassName("autocomplete-items");
    [...boxes].forEach((b) => {
      if (el !== b && el !== inp) b.parentNode.removeChild(b);
    });
  }
  document.addEventListener("click", (e) => closeAll(e.target));
}

// ───────────────── 표시 유틸 ─────────────────
function clearResult() {
  const box = document.getElementById("resultBox");
  if (box) box.textContent = "";
}
function showConfirmed(company, productType) {
  const box = document.getElementById("resultBox");
  box.innerHTML = `
      <div>회사명 : <strong>${company}</strong></div>
      <div>제품 유형 : <strong>${productType}</strong></div>
    `;
}

function showNeedSelection() {
  const box = document.getElementById("resultBox");
  box.textContent = "하나를 선택하거나 정확히 입력 후 Enter/조회";
}

// ───────────────── 실제 적용 (Enter/조회에서만 호출) ─────────────────
// explicit=true: 사용자가 명시적으로 확정(자동완성 선택 또는 Enter)한 시나리오
function resolveAndApply(explicit = false) {
  const input = document.getElementById("companyInput").value.trim();
  if (!input) {
    clearResult();
    return;
  }

  const keys = Object.keys(companyMap || {});
  if (!keys.length) {
    clearResult();
    return;
  }

  const exact = keys.find((k) => norm(k) === norm(input));

  // 규칙:
  // - explicit=true  → 입력값이 companyMap의 "정확한 키"일 때만 적용
  // - explicit=false → (조회 버튼 정책 바꾸기용) 기본은 정확 일치만 적용
  let company = null;
  if (explicit) {
    if (keys.includes(input)) company = input; // 대소문자/공백 동일
    else if (exact) company = exact; // 정규화 일치 허용
  } else {
    if (exact) company = exact;
  }

  if (!company) {
    showNeedSelection();
    return;
  }

  const productType = companyMap[company];
  showConfirmed(company, productType); // ★ 확정된 경우에만 표시
  applyToRedmine(company, productType); // ★ 이때만 실제 적용
}

// ───────────────── 초기화 ─────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await loadCompanyMap();

  const inp = document.getElementById("companyInput");
  inp.focus();

  // 자동완성 초기화
  autocomplete(inp, Object.keys(companyMap || {}));

  // 타이핑: 후보/미리보기 표시 안 함, 항상 비움
  let t;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(clearResult, 120);
  });

  // 조회 버튼: Enter와 동일(명시적 확정으로 처리)
  document.getElementById("searchBtn")?.addEventListener("click", () => {
    resolveAndApply(true);
  });
});

// ===== 담당자 즐겨찾기 (칩 UI) =====
const KEY = "favoriteAssignees"; // [{ name: "이현빈" }]
const assigneeInput = document.getElementById("assigneeInput");
const btnAddFav = document.getElementById("btnAddFav");
const favList = document.getElementById("favList");

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderFavs(favs = []) {
  favList.innerHTML = "";          // 비우기
  // 비었으면 CSS :empty 규칙으로 자동 숨김됨
  favs.forEach(({ name }) => {
    const li = document.createElement("li");
    li.className = "chip";

    const bName = document.createElement("button");
    bName.className = "chip__name";
    bName.textContent = name;
    bName.dataset.name = name;
    bName.title = "클릭하면 담당자에 적용";

    const bDel = document.createElement("button");
    bDel.className = "chip__x";
    bDel.textContent = "❌";
    bDel.dataset.name = name;
    bDel.title = "삭제";

    li.appendChild(bName);
    li.appendChild(bDel);
    favList.appendChild(li);
  });
}


// 칩 클릭(적용/삭제) — 이벤트 위임
favList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const name = btn.dataset.name;
  if (!name) return;

  if (btn.classList.contains("chip__name")) {
    const res = await sendMsgToContent({ type: "APPLY_ASSIGNEE_NAME", name });
    if (!res?.ok) {
      alert("담당자 적용에 실패했습니다. (이슈 작성 페이지/폼이 열려있는지 확인)");
      console.warn("[popup] apply failed:", res);
    } else {
      // ✨ 팝업은 닫지 않음. 시각 피드백만
      const chip = btn.closest(".chip");
      chip?.classList.add("applied");
      setTimeout(() => chip?.classList.remove("applied"), 900);
    }
  } else if (btn.classList.contains("chip__x")) {
    chrome.storage.sync.get(["favoriteAssignees"], (data) => {
      const list = (data.favoriteAssignees || []).filter((x) => x.name !== name);
      chrome.storage.sync.set({ favoriteAssignees: list }, () => renderFavs(list));
    });
  }
});

// 추가 버튼 / Enter 입력으로 즐겨찾기 등록
btnAddFav.addEventListener("click", () => {
  const name = (assigneeInput.value || "").trim();
  if (!name) return alert("담당자 이름을 입력하세요.");
  chrome.storage.sync.get([KEY], (data) => {
    const list = data[KEY] || [];
    if (list.some((x) => x.name === name)) return alert("이미 즐겨찾기에 있습니다.");
    list.push({ name });
    chrome.storage.sync.set({ [KEY]: list }, () => {
      assigneeInput.value = "";
      renderFavs(list);
    });
  });
});
assigneeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnAddFav.click();
});

// 팝업 열릴 때 저장된 즐겨찾기 로드
function initFavs() {
  chrome.storage.sync.get([KEY], (data) => {
    renderFavs(data[KEY] || []);
  });
}
document.addEventListener("DOMContentLoaded", initFavs);

// ---- popup.js: content.js 주입/메시지 전송 보장 헬퍼 ----
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// content.js가 떠 있는지 PING으로 확인
function pingContent(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "PING" }, () => {
      resolve(!chrome.runtime.lastError); // 있으면 true
    });
  });
}

// 없으면 주입하고 다시 확인
async function ensureContentLoaded(tabId) {
  if (await pingContent(tabId)) return true;

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"],
  });

  // 약간 대기 후 재핑
  await new Promise((r) => setTimeout(r, 60));
  return pingContent(tabId);
}

// 메시지 객체 그대로 전송
async function sendMsgToContent(msgObject) {
  const tabId = await getActiveTabId();
  if (!tabId) return { ok: false, error: "NO_TAB" };

  const ready = await ensureContentLoaded(tabId);
  if (!ready) return { ok: false, error: "INJECT_FAIL" };

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msgObject, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res || { ok: false });
      }
    });
  });
}
