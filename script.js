function setResult(t) { document.getElementById('result').textContent = t || ''; }

async function sendToContent(type, payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { setResult('활성 탭을 찾을 수 없습니다.'); return; }

  // content.js 로드 확인 (PING)
  let loaded = true;
  try { await chrome.tabs.sendMessage(tab.id, { type: 'PING' }); }
  catch { loaded = false; }
  if (!loaded) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
  }
  await chrome.tabs.sendMessage(tab.id, { type, payload });
}

function errorTemplateHTML() {
  return `
<h2><strong>1. 오류 요약</strong></h2>
<p>&nbsp;</p>

<h2><strong>2. 오류 현상</strong></h2>
<ol>
  <li><strong>발생 일시:</strong></li>
  <li><strong>오류 영향 범위:</strong></li>
  <li><strong>사용자 정보:</strong></li>
  <li><strong>구체적 현상:</strong></li>
</ol>

<h2><strong>3. 재현 여부</strong></h2>
<p>&nbsp;</p>

<h2><strong>4. 재현 방법 또는 오류를 발견했던 절차</strong></h2>
<p>&nbsp;</p>

<h2><strong>5. 조치 여부 및 내용</strong></h2>
<p>&nbsp;</p>

<h2><strong>6. 오류 분석 및 원인</strong></h2>
<p>&nbsp;</p>

<h2><strong>7. 재발 방지 대책</strong></h2>
<p>&nbsp;</p>
`.trim();
}

function requestTemplateHTML() {
  return `
<h2><strong>1. 요청 내용</strong></h2>
<p>&nbsp;</p>

<h2><strong>2. 요청 사유</strong></h2>
<p>&nbsp;</p>

<h2><strong>3. 요청 일시(작업 기한)</strong></h2>
<p>&nbsp;</p>

<h2><strong>4. 요청자</strong></h2>
<p>&nbsp;</p>

<h2><strong>5. 요청 관리</strong></h2>
<p>&nbsp;</p>
`.trim();
}


document.getElementById('errorTemplateBtn').addEventListener('click', async () => {
  setResult('오류 템플릿 적용 중…');
  await sendToContent('APPLY_TEMPLATE_VIA_SOURCE', {
    html: errorTemplateHTML(),
    ensureShowBlocks: true    // 적용 후 블록보기 ON
  });
  setResult('오류 템플릿이 삽입되었습니다.');
});

document.getElementById('requestTemplateBtn').addEventListener('click', async () => {
  setResult('요청 템플릿 적용 중…');
  await sendToContent('APPLY_TEMPLATE_VIA_SOURCE', {
    html: requestTemplateHTML(),
    ensureShowBlocks: true
  });
  setResult('요청 템플릿이 삽입되었습니다.');
});
