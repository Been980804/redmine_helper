// ============================================================================
// content.js  (레드마인 일감 등록 도우미 - 통합판)
// - 템플릿 삽입 (오류/요청) → 지원항목 자동/해결주체=운영팀/블록보기 ON
// - 회사명/제품유형 자동 반영
// - 담당자 즐겨찾기(수동 입력) 적용: 입력한 이름을 느슨 매칭해 드롭다운 자동 선택
// - 완료일( Due Date ) 오늘로 설정: 팝업에서 호출 시 적용(SET_DUE_TODAY)
// ============================================================================

// iframe에서는 동작하지 않게
if (window.top !== window) {
  // no-op
} else if (!window.__REDMINE_HELPER_CONTENT__) {
  window.__REDMINE_HELPER_CONTENT__ = true;

  console.log('[content] loaded:', location.href);

  // ──────────────────────────────────────────────────────────────────────────
  // 공통 유틸
  // ──────────────────────────────────────────────────────────────────────────
  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm  = (s) => (s || '').toString().trim().replace(/\s+/g,'').toLowerCase();

  async function waitFor(testFn, timeoutMs = 3000, step = 120) {
    const t0 = Date.now();
    let ret;
    while (Date.now() - t0 < timeoutMs) {
      try { ret = await testFn(); } catch {}
      if (ret) return ret;
      await sleep(step);
    }
    return null;
  }

  // 이름 느슨 매칭용: 기호/공백/문장부호 제거 + 소문자화 (ⓕ, •, 괄호, 공백 등 무시)
  function normName(s) {
    return (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[\p{P}\p{S}\s]/gu, ""); // 유니코드: punctuation/symbol/space 제거
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CKEditor/툴바 헬퍼
  // ──────────────────────────────────────────────────────────────────────────
  function findToolbarButton(regex, scope = document) {
    const nodes = Array.from(scope.querySelectorAll(
      'a.cke_button, a.cke_button_on, a.cke_button_off, a.cke_button_disabled'
    ));
    return nodes.find(a => {
      const t  = a.getAttribute('title') || '';
      const al = a.getAttribute('aria-label') || '';
      return regex.test(t) || regex.test(al);
    }) || null;
  }
  function isButtonOn(btn){ return !!(btn && btn.classList.contains('cke_button_on')); }
  function isDisabled(btn){ return !!(btn && (btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('cke_button_disabled'))); }
  function safeClick(el){ if (!el || isDisabled(el)) return false; el.click(); return true; }

  function getActiveEditorRoot() {
    const src = document.querySelector('.CodeMirror, textarea.cke_source');
    if (src) return src.closest('.cke, .cke_editor') || document;
    const wys = document.querySelector('iframe.cke_wysiwyg_frame, .cke_wysiwyg_div[contenteditable="true"], .cke_editable[contenteditable="true"]');
    if (wys) return wys.closest('.cke, .cke_editor') || document;
    return document;
  }

  function isInSourceMode() {
    const root = getActiveEditorRoot();
    const srcBtn = findToolbarButton(/(소스|Source)/i, root);
    if (isButtonOn(srcBtn)) return true;
    if (root.querySelector('.CodeMirror, textarea.cke_source')) return true;
    return false;
  }

  async function ensureShowBlocksOn(root = document) {
    // v4 API 우선
    try {
      if (window.CKEDITOR && CKEDITOR.instances && Object.keys(CKEDITOR.instances).length) {
        const ed = CKEDITOR.instances['issue_description'] || CKEDITOR.instances[Object.keys(CKEDITOR.instances)[0]];
        if (ed) {
          const cmd = ed.getCommand('showblocks');
          if (cmd && cmd.state !== CKEDITOR.TRISTATE_DISABLED && cmd.state !== CKEDITOR.TRISTATE_ON) {
            ed.execCommand('showblocks'); // OFF → ON
          }
          return;
        }
      }
    } catch {}
    // 버튼 DOM으로 처리
    const btn = findToolbarButton(/(블록\s*보기|Show\s*Blocks)/i, root);
    if (!btn) return;
    if (!isButtonOn(btn)) {
      for (let i = 0; i < 8; i++) { if (safeClick(btn)) break; await sleep(60); }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 템플릿 삽입: 지원항목/해결주체 자동 선택
  // ──────────────────────────────────────────────────────────────────────────
  function detectCategoryFromHtml(html) {
    const h = (html || '').toLowerCase();
    if (/(^|\s)요청\s*내용|요청\s*사유|요청\s*일시/.test(h)) return '요청';
    if (/오류\s*요약|오류\s*현상|재현\s*방법/.test(h)) return '오류';
    return null;
  }

  function findSupportSelect() {
    // 1) 알려진 id(있다면)
    let sel = qs('#issue_custom_field_values_72');
    if (sel?.tagName === 'SELECT') return sel;

    // 2) label = 지원항목
    const labs = qsa('label[for^="issue_custom_field_values_"]');
    for (const lb of labs) {
      const txt = (lb.textContent || '').trim();
      if (/지원\s*항목/i.test(txt)) {
        const forId = lb.getAttribute('for');
        const el = document.getElementById(forId);
        if (el?.tagName === 'SELECT') return el;
      }
    }

    // 3) 옵션 후보로 추정
    const cands = qsa('select[id^="issue_custom_field_values_"], select.list_cf, select');
    const keys = ['오류','요청','질문','업무','제안','접수','공사','관리'].map(norm);
    for (const s of cands) {
      const opts = Array.from(s.options || []);
      const has = opts.some(o => keys.includes(norm(o.textContent)) || keys.includes(norm(o.value)));
      if (has) return s;
    }
    return null;
  }

  function applySupportCategory(category) {
    if (!category) return false;
    const sel = findSupportSelect();
    if (!sel) { console.warn('[content] support select not found'); return false; }

    const target = norm(category);
    const opts = Array.from(sel.options || []);
    const hit = opts.find(o => norm(o.textContent) === target || norm(o.value) === target);
    if (!hit) { console.warn('[content] support option not found for', category); return false; }

    sel.selectedIndex = opts.indexOf(hit);
    hit.selected = true;
    sel.value = hit.value;
    try { sel.dispatchEvent(new Event('input',  { bubbles:true })); } catch {}
    try { sel.dispatchEvent(new Event('change', { bubbles:true })); } catch {}
    console.log('[content] support category applied:', hit.textContent || hit.value);
    return true;
  }

  function findResolverSelect() {
    // 1) 알려진 id(예: 116)
    let sel = qs('#issue_custom_field_values_116');
    if (sel?.tagName === 'SELECT') return sel;

    // 2) label = 해결주체
    const labs = qsa('label[for^="issue_custom_field_values_"]');
    for (const lb of labs) {
      const txt = (lb.textContent || '').trim();
      if (/해결\s*주체/i.test(txt)) {
        const forId = lb.getAttribute('for');
        const el = document.getElementById(forId);
        if (el?.tagName === 'SELECT') return el;
      }
    }

    // 3) 옵션에 운영팀/연구소 등이 있는 select
    const cands = qsa('select[id^="issue_custom_field_values_"], select.list_cf, select');
    const keys = ['운영팀','연구소'].map(norm);
    for (const s of cands) {
      const opts = Array.from(s.options || []);
      const has = opts.some(o => keys.includes(norm(o.textContent)) || keys.includes(norm(o.value)));
      if (has) return s;
    }
    return null;
  }

  function applyResolverTeamAlways() {
    const sel = findResolverSelect();
    if (!sel) { console.warn('[content] resolver select not found'); return false; }

    const opts = Array.from(sel.options || []);
    const hit = opts.find(o => norm(o.textContent) === '운영팀' || norm(o.value) === '운영팀');
    if (!hit) { console.warn('[content] resolver option "운영팀" not found'); return false; }

    sel.selectedIndex = opts.indexOf(hit);
    hit.selected = true;
    sel.value = hit.value;
    try { sel.dispatchEvent(new Event('input',  { bubbles:true })); } catch {}
    try { sel.dispatchEvent(new Event('change', { bubbles:true })); } catch {}
    console.log('[content] resolver applied: 운영팀');
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 에디터 감지 & 삽입 루틴 (템플릿)
  // ──────────────────────────────────────────────────────────────────────────
  function detectV4() {
    try {
      if (window.CKEDITOR && CKEDITOR.instances && Object.keys(CKEDITOR.instances).length) {
        return CKEDITOR.instances['issue_description'] || CKEDITOR.instances[Object.keys(CKEDITOR.instances)[0]];
      }
    } catch {}
    return null;
  }
  function detectV5El() { return qs('.ck-editor__editable, .ck-content[contenteditable="true"]'); }
  function detectSourceDom() { return qs('.CodeMirror') || qs('textarea.cke_source, #issue_description, textarea'); }
  function detectWysiwygDom() {
    const iframe = qs('iframe.cke_wysiwyg_frame, [id^="cke_"][id$="_contents"] iframe');
    const divCE  = qs('.cke_wysiwyg_div[contenteditable="true"], .cke_editable[contenteditable="true"], [id^="cke_"][id$="_contents"] [contenteditable="true"]');
    return { iframe, divCE };
  }

  function injectDirectWysiwygAndTextarea(html) {
    let changed = false;

    try {
      const { iframe, divCE } = detectWysiwygDom();
      if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
        iframe.contentDocument.body.innerHTML = html;
        try { iframe.contentDocument.body.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
        changed = true;
      }
      if (!changed && divCE) {
        divCE.innerHTML = html;
        try { divCE.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
        changed = true;
      }
    } catch (e) { console.warn('[content] direct WYSIWYG error', e); }

    try {
      const ta = qs('#issue_description') || qs('textarea.cke_source') || qs('textarea');
      if (ta) {
        ta.value = html;
        try { ta.dispatchEvent(new Event('input',  { bubbles:true })); } catch {}
        try { ta.dispatchEvent(new Event('change', { bubbles:true })); } catch {}
        changed = true || changed;
      }
    } catch (e) {}

    return changed;
  }

  function whenReadyV4(ed, cb){ if (!ed) return; if (ed.status === 'ready') cb(); else ed.on('instanceReady', cb); }
  function finalizeV4(ed, ensureShowBlocks, category) {
    try {
      if (ed.mode === 'source') ed.execCommand('source');
      if (ensureShowBlocks !== null) {
        const cmd = ed.getCommand('showblocks');
        if (cmd && cmd.state !== CKEDITOR.TRISTATE_DISABLED && cmd.state !== CKEDITOR.TRISTATE_ON) {
          ed.execCommand('showblocks'); // ON 고정
        }
      }
      ed.focus();
    } catch {}
    if (category) applySupportCategory(category);
    applyResolverTeamAlways();
    console.log('[content] v4 finalized');
  }
  function applyV4(ed, html, { ensureShowBlocks = true, category = null } = {}) {
    whenReadyV4(ed, () => {
      try { ed.config && (ed.config.allowedContent = true); ed.setData(html); console.log('[content] v4 setData done'); finalizeV4(ed, ensureShowBlocks, category); return; }
      catch (e1) { try { ed.config && (ed.config.allowedContent = true); ed.insertHtml(html); console.log('[content] v4 insertHtml done'); finalizeV4(ed, ensureShowBlocks, category); return; } catch (e2) {} }
      const inject = () => injectIntoV4Source(ed, html, () => finalizeV4(ed, ensureShowBlocks, category));
      if (ed.mode === 'source') inject();
      else { const onMode = () => { ed.removeListener('mode', onMode); setTimeout(inject, 0); }; ed.on('mode', onMode); ed.execCommand('source'); }
    });
  }
  function injectIntoV4Source(ed, html, done) {
    const contents = ed.container && ed.container.findOne('[id$="_contents"]');
    const root = contents ? contents.$ : (ed.container && ed.container.$);
    const cmWrap = root && qs('.CodeMirror', root);
    if (cmWrap) {
      const cm = cmWrap.CodeMirror || cmWrap.parentElement?.CodeMirror || cmWrap.nextSibling?.CodeMirror || cmWrap.previousSibling?.CodeMirror;
      if (cm?.setValue) { cm.setValue(html); cm.refresh?.(); try{cm.focus();}catch{} console.log('[content] v4 inject via CodeMirror'); return done?.(); }
    }
    const ta = root && (qs('textarea.cke_source', root) || qs('textarea', root));
    if (ta) { ta.value = html; try{ta.dispatchEvent(new Event('input',{bubbles:true}))}catch{} try{ta.dispatchEvent(new Event('change',{bubbles:true}))}catch{} console.log('[content] v4 inject via textarea'); return done?.(); }
    setTimeout(() => injectIntoV4Source(ed, html, done), 50);
  }

  function applyV5(editableEl, html, { category = null, ensureShowBlocks = true } = {}) {
    const inst = editableEl.ckeditorInstance || editableEl.__ckeditorInstance;
    if (inst?.setData) {
      try { inst.setData(html); inst.editing?.view?.focus?.(); console.log('[content] v5 setData done'); }
      catch (e) {}
    } else {
      try {
        editableEl.focus();
        const ok = document.execCommand && document.execCommand('insertHTML', false, html);
        if (!ok) {
          editableEl.innerHTML = html;
          try { editableEl.dispatchEvent(new Event('input',  { bubbles:true })); } catch {}
          try { editableEl.dispatchEvent(new Event('change', { bubbles:true })); } catch {}
        }
        console.log('[content] v5 DOM insert done');
      } catch (e2) { console.warn('[content] v5 DOM insert failed', e2); }
    }
    if (ensureShowBlocks) ensureShowBlocksOn(getActiveEditorRoot());
    if (category) applySupportCategory(category);
    applyResolverTeamAlways();
  }

  async function applySourceFallback(html, { ensureShowBlocks = true, category = null } = {}) {
    if (injectDirectWysiwygAndTextarea(html)) {
      console.log('[content] direct WYSIWYG (late) done');
      if (ensureShowBlocks) await ensureShowBlocksOn(getActiveEditorRoot());
      if (category) applySupportCategory(category);
      applyResolverTeamAlways();
      return;
    }

    const cmWrap = qs('.CodeMirror');
    const cm = cmWrap && (cmWrap.CodeMirror ||
                          cmWrap.parentElement?.CodeMirror ||
                          cmWrap.nextSibling?.CodeMirror ||
                          cmWrap.previousSibling?.CodeMirror);
    if (cm?.setValue) {
      cm.setValue(html);
      cm.refresh?.();
      try{cm.focus();}catch{}
      console.log('[content] fallback CodeMirror done');

      const root = getActiveEditorRoot();
      const srcBtn = findToolbarButton(/(소스|Source)/i, root);
      if (isButtonOn(srcBtn)) { safeClick(srcBtn); await sleep(140); }
      if (ensureShowBlocks) await ensureShowBlocksOn(root);
      if (category) applySupportCategory(category);
      applyResolverTeamAlways();
      return;
    }

    const ta = qs('textarea.cke_source, #issue_description, textarea');
    if (ta) {
      ta.value = html;
      try { ta.dispatchEvent(new Event('input',  { bubbles:true })); } catch {}
      try { ta.dispatchEvent(new Event('change', { bubbles:true })); } catch {}
      console.log('[content] fallback textarea done');

      const root = getActiveEditorRoot();
      const srcBtn = findToolbarButton(/(소스|Source)/i, root);
      if (isButtonOn(srcBtn)) { safeClick(srcBtn); await sleep(140); }
      if (ensureShowBlocks) await ensureShowBlocksOn(root);
      if (category) applySupportCategory(category);
      applyResolverTeamAlways();
      return;
    }

    console.warn('[content] fallback: no editor DOM found');
  }

  async function routeApply(html, { ensureShowBlocks = true } = {}) {
    const category = detectCategoryFromHtml(html); // 오류/요청/null

    if (isInSourceMode()) {
      await applyInSourceThenBack(html, { ensureShowBlocks, category });
      return;
    }

    if (injectDirectWysiwygAndTextarea(html)) {
      console.log('[content] direct WYSIWYG done');
      if (ensureShowBlocks) await ensureShowBlocksOn(getActiveEditorRoot());
      if (category) applySupportCategory(category);
      applyResolverTeamAlways();
      return;
    }

    const kind = await waitFor(() => {
      const v4 = detectV4();        if (v4) return { kind: 'v4', ed: v4 };
      const v5 = detectV5El();      if (v5) return { kind: 'v5', el: v5 };
      const sd = detectSourceDom(); if (sd) return { kind: 'source', el: sd };
      return null;
    });

    if (!kind) { console.warn('[content] no editor detected'); return; }
    console.log('[content] detected:', kind.kind);

    if (kind.kind === 'v4') return applyV4(kind.ed, html, { ensureShowBlocks, category });
    if (kind.kind === 'v5') return applyV5(kind.el, html, { category, ensureShowBlocks });
    return applySourceFallback(html, { ensureShowBlocks, category });
  }

  async function applyInSourceThenBack(html, { ensureShowBlocks = true, category = null } = {}) {
    const root = getActiveEditorRoot();

    // 1) 소스 DOM 삽입
    const cmWrap = root.querySelector('.CodeMirror');
    const cm = cmWrap && (cmWrap.CodeMirror ||
                          cmWrap.parentElement?.CodeMirror ||
                          cmWrap.nextSibling?.CodeMirror ||
                          cmWrap.previousSibling?.CodeMirror);
    if (cm?.setValue) {
      cm.setValue(html);
      cm.refresh?.();
      try { cm.focus(); } catch {}
      console.log('[content] src: CodeMirror set');
    } else {
      const ta = root.querySelector('textarea.cke_source, #issue_description, textarea');
      if (ta) {
        ta.value = html;
        try { ta.dispatchEvent(new Event('input',  { bubbles:true })); } catch {}
        try { ta.dispatchEvent(new Event('change', { bubbles:true })); } catch {}
        console.log('[content] src: textarea set');
      } else {
        console.warn('[content] src: no CodeMirror/textarea');
      }
    }

    // 2) 소스 → 블록보기로 복귀
    const srcBtn = findToolbarButton(/(소스|Source)/i, root);
    if (srcBtn && isButtonOn(srcBtn)) {
      for (let i = 0; i < 10; i++) { if (safeClick(srcBtn)) break; await sleep(60); }
      await sleep(140);
    }

    // 3) UI-Textarea 동기화 안전망
    setTimeout(() => { injectDirectWysiwygAndTextarea(html); }, 120);

    // 4) 항상 블록 보기 ON
    if (ensureShowBlocks) await ensureShowBlocksOn(root);

    // 5) 지원항목/해결주체
    if (category) applySupportCategory(category);
    applyResolverTeamAlways();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 회사명/제품유형 자동 반영
  // ──────────────────────────────────────────────────────────────────────────
  function findInputByLabel(regex) {
    const labels = [...document.querySelectorAll('label[for]')];
    const lb = labels.find(x => regex.test((x.textContent||'').trim()));
    if (lb) {
      const el = document.getElementById(lb.getAttribute('for'));
      if (el) return el;
    }
    const xb = [...document.querySelectorAll('label')].find(x => regex.test((x.textContent||'').trim()));
    if (xb) {
      const near = xb.nextElementSibling || xb.parentElement?.querySelector('input,textarea,select');
      if (near) return near;
    }
    return null;
  }

  function findCompanyInput() {
    return findInputByLabel(/회사명|고객사명|Company|Customer/i)
        || document.querySelector('#issue_custom_field_values_company')
        || document.querySelector('input[name="issue[custom_field_values][company]"]');
  }

  function findProductTypeSelect() {
    let sel = document.querySelector('#issue_custom_field_values_174');
    if (sel) { return sel; }

    const labels = [...document.querySelectorAll('label[for^="issue_custom_field_values_"],label[for]')];
    const lb = labels.find(x => /제품유형|Product\s*Type/i.test((x.textContent||'').trim()));
    if (lb) {
      const el = document.getElementById(lb.getAttribute('for'));
      if (el?.tagName === 'SELECT') { return el; }
    }

    sel = document.querySelector('select[id^="issue_custom_field_values_"]');
    return sel;
  }

  function applyCompanyName(name) {
    const el = findCompanyInput();
    if (!el) { console.warn('[content] company input not found'); return false; }
    el.value = name;
    ['input','change','blur'].forEach(t => { try { el.dispatchEvent(new Event(t,{bubbles:true,cancelable:true})); } catch{} });
    if (window.jQuery) try { window.jQuery(el).trigger('change'); } catch {}
    console.log('[content] company applied:', name);
    return true;
  }

  function setSelectedWithAttr(sel, targetText) {
    const want = norm(targetText);
    let targetIdx = -1;
    for (let i=0; i<sel.options.length; i++){
      const o = sel.options[i];
      if (norm(o.value) === want || norm(o.textContent) === want) { targetIdx = i; break; }
    }
    if (targetIdx < 0) return false;

    for (const o of sel.options) { o.selected = false; o.removeAttribute('selected'); }

    const opt = sel.options[targetIdx];
    opt.selected = true; opt.setAttribute('selected','selected');
    sel.selectedIndex = targetIdx;
    sel.value = opt.value;

    ['input','change','blur'].forEach(t => { try { sel.dispatchEvent(new Event(t,{bubbles:true,cancelable:true})); } catch{} });
    if (window.jQuery) try { window.jQuery(sel).trigger('change'); } catch {}
    return true;
  }

  function applyProductType(productType) {
    const sel = findProductTypeSelect();
    if (!sel) { console.warn('[content] product-type select not found'); return false; }

    const aliases = { 'vdisk':'V-Disk', 'v-disk':'V-Disk', '가상디스크':'가상디스크' };
    const key = aliases[norm(productType)] || productType;

    const ok = setSelectedWithAttr(sel, key);
    if (!ok) {
      console.warn('[content] no option matched for:', productType,
        '\nvalues:', [...sel.options].map(o=>o.value),
        '\ntexts:',  [...sel.options].map(o=>o.textContent));
    } else {
      console.log('[content] product applied:', key);
    }
    return ok;
  }

  function whenReady(fn) {
    if (fn()) return true;
    const mo = new MutationObserver(() => { if (fn()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList:true, subtree:true });
    return false;
  }

  // 중복 전송 가드
  const dedup = { lastKey: null, lastAt: 0, windowMs: 400 };
  function makeKey(payload) {
    if (payload?.__reqId) return `id:${payload.__reqId}`;
    const company = (payload?.company ?? '').trim();
    const productType = (payload?.productType ?? '').trim();
    return `c:${company}|p:${productType}`;
  }
  function isDuplicate(payload) {
    const now = Date.now();
    const key = makeKey(payload);
    if (key === dedup.lastKey && (now - dedup.lastAt) < dedup.windowMs) return true;
    dedup.lastKey = key; dedup.lastAt = now; return false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 담당자 (수동 입력 즐겨찾기) 적용 함수
  // ──────────────────────────────────────────────────────────────────────────
  function findAssigneeSelect() {
    // 1) id
    let el = document.getElementById('issue_assigned_to_id');
    if (el?.tagName === 'SELECT') return el;

    // 2) name
    el = document.querySelector('select[name="issue[assigned_to_id]"]');
    if (el) return el;

    // 3) label: "담당자"
    const labels = [...document.querySelectorAll('label[for]')];
    const lb = labels.find(x => /담당자/i.test((x.textContent || '').trim()));
    if (lb) {
      const cand = document.getElementById(lb.getAttribute('for'));
      if (cand?.tagName === 'SELECT') return cand;
    }

    // 4) 최후 추정: 옵션에 사용자 느낌이 있는 select
    const cands = [...document.querySelectorAll('select')];
    for (const s of cands) {
      const hasUserish = [...s.options].some(o => (o.textContent || "").includes("님"));
      if (hasUserish) return s;
    }
    return null;
  }

  function applyAssigneeByNameLoose(inputName) {
    const sel = findAssigneeSelect();
    if (!sel) { console.warn('[content] assignee select not found'); return false; }

    const target = normName(inputName);
    const opts = [...sel.options];

    // 1) 값(ID)로도 허용: 사용자가 숫자 ID를 입력했다면
    let hit = opts.find(o => norm(String(o.value)) === norm(String(inputName)));

    // 2) 텍스트 느슨 매칭: "ⓕ이 현빈" vs "이현빈"
    if (!hit) {
      hit = opts.find(o => normName(o.textContent) === target);
    }
    // 3) 부분 포함 매칭(최후 수단)
    if (!hit) {
      hit = opts.find(o => normName(o.textContent).includes(target));
    }

    if (!hit) { console.warn('[content] assignee option not found for', inputName); return false; }

    sel.selectedIndex = opts.indexOf(hit);
    hit.selected = true;
    sel.value = hit.value;

    try { sel.dispatchEvent(new Event('input',  { bubbles:true })); } catch {}
    try { sel.dispatchEvent(new Event('change', { bubbles:true })); } catch {}

    console.log('[content] assignee applied:', (hit.textContent || hit.value));
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 완료일( Due Date ) 오늘로 설정
  // ──────────────────────────────────────────────────────────────────────────
  function findDueDateInput() {
    // 1) 명시 id
    let el = document.getElementById('issue_due_date');
    if (el?.tagName === 'INPUT') return el;

    // 2) name=issue[due_date]
    el = document.querySelector('input[name="issue[due_date]"]');
    if (el) return el;

    // 3) label 매칭
    el = findInputByLabel(/완료일|Due\s*Date/i);
    if (el?.tagName === 'INPUT') return el;

    // 4) type=date 후보
    el = document.querySelector('input[type="date"]');
    return el;
  }

  function todayYYYYMMDD() {
    // 로컬 타임존 기준 yyyy-mm-dd (타임존 오프셋 보정)
    const dt = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return dt.toISOString().split('T')[0];
  }

  function setDueToday({ force = true } = {}) {
    const el = findDueDateInput();
    if (!el) { console.warn('[content] due-date input not found'); return false; }

    if (!force && el.value) return true; // 비어있을 때만

    el.value = todayYYYYMMDD();
    try { el.dispatchEvent(new Event('input',  { bubbles:true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles:true })); } catch {}
    console.log('[content] due date set to today');
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 메시지 핸들러 (템플릿/회사명·제품유형/담당자-수동입력/완료일)
  // ──────────────────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'PING') { sendResponse({ ok:true }); return true; }

    // 템플릿 삽입
    if (msg?.type === 'APPLY_TEMPLATE_VIA_SOURCE' && msg.payload) {
      const { html, ensureShowBlocks = true } = msg.payload || {};
      routeApply(html, { ensureShowBlocks });
      return true;
    }

    // 회사명/제품유형 반영
    if (msg?.type === 'APPLY_COMPANY' && msg?.payload) {
      if (isDuplicate(msg.payload)) return true;
      const { company, productType } = msg.payload;

      whenReady(() => applyCompanyName(company));
      whenReady(() => applyProductType(productType));
      return true;
    }

    // 담당자 즐겨찾기(수동 입력) → 이름 기반 느슨 매칭 적용
    if (msg?.type === 'APPLY_ASSIGNEE_NAME' && msg?.name) {
      const ok = applyAssigneeByNameLoose(msg.name);
      try { chrome.storage?.sync?.set?.({ lastUsedFavName: msg.name }); } catch {}
      sendResponse({ ok: !!ok });
      return true;
    }

    // 완료일 오늘로 설정 (팝업 열릴 때 등에서 호출)
    if (msg?.type === 'SET_DUE_TODAY') {
      // 필드가 늦게 렌더링되는 경우 대비
      const force = !!msg.force;
      const applyNow = () => setDueToday({ force });
      const okImmediate = applyNow();
      if (!okImmediate) {
        whenReady(() => applyNow());
      }
      sendResponse({ ok: !!okImmediate });
      return true;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 끝
  // ──────────────────────────────────────────────────────────────────────────
}
