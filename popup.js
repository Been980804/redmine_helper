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

// 담당자 즐겨찾기
const KEY = "favoriteAssignees"; // [{ name: "이현빈" }]
const assigneeInput = document.getElementById("assigneeInput");
const btnAddFav = document.getElementById("btnAddFav");
const favList = document.getElementById("favList");
const autoApply = document.getElementById("autoApply");

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderFavs(favs = []) {
  favList.innerHTML = "";
  if (!favs.length) {
    const li = document.createElement("li");
    li.textContent = "즐겨찾기가 없습니다.";
    li.className = "muted";
    favList.appendChild(li);
    return;
  }
  favs.forEach(({ name }) => {
    const li = document.createElement("li");

    const left = document.createElement("span");
    left.textContent = name;

    const right = document.createElement("div");

    const bApply = document.createElement("button");
    bApply.textContent = "적용";
    bApply.addEventListener("click", async () => {
      const tab = await getActiveTab();
      chrome.tabs.sendMessage(
        tab.id,
        { type: "APPLY_ASSIGNEE_NAME", name },
        (res) => {
          if (!res?.ok) alert("현재 페이지에서 담당자 적용에 실패했습니다.");
          else {
            // 마지막 사용 저장(컨텐츠 스크립트에서도 저장하지만 보조로)
            chrome.storage.sync.set({ lastUsedFavName: name });
            window.close();
          }
        }
      );
    });

    const bDel = document.createElement("button");
    bDel.textContent = "삭제";
    bDel.className = "tiny";
    bDel.addEventListener("click", () => {
      chrome.storage.sync.get([KEY], (data) => {
        const list = (data[KEY] || []).filter((x) => x.name !== name);
        chrome.storage.sync.set({ [KEY]: list }, () => renderFavs(list));
      });
    });

    right.appendChild(bApply);
    right.appendChild(bDel);

    li.appendChild(left);
    li.appendChild(right);
    favList.appendChild(li);
  });
}

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

autoApply.addEventListener("change", () => {
  chrome.storage.sync.set({ autoApplyLastFav: autoApply.checked });
});

function init() {
  chrome.storage.sync.get([KEY, "autoApplyLastFav"], (data) => {
    renderFavs(data[KEY] || []);
    autoApply.checked = !!data.autoApplyLastFav;
  });
}
document.addEventListener("DOMContentLoaded", init);
