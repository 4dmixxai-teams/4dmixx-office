// ── meeting.js  ── orchestrator + API + log ───────────────────────────────────

let _apiKey = '';
let _running = false;

// ─── UI helpers ──────────────────────────────────────────────────────────────
function saveKey(){
  const v = document.getElementById('apiKey').value.trim();
  if(!v.startsWith('sk-ant-')){
    document.getElementById('apiOk').textContent = '✗ 형식 오류';
    document.getElementById('apiOk').style.color = '#e94560';
    return;
  }
  _apiKey = v;
  document.getElementById('apiOk').textContent = '✓ 저장됨';
  document.getElementById('apiOk').style.color = '#44ff88';
}

function setProgress(pct){
  document.getElementById('progFill').style.width = pct + '%';
}

function setStatus(s){
  const el = document.getElementById('statusBadge');
  el.textContent = s === 'idle' ? 'IDLE' : s === 'running' ? 'RUNNING' : 'DONE';
  el.className = 'top-badge ' + s;
}

function setTopicStatus(idx, s){
  const el = document.getElementById('ts'+idx);
  if(!el) return;
  el.className = 'topic-row ' + s;
}

// ─── Log helpers ─────────────────────────────────────────────────────────────
function logDivider(title){
  const area = document.getElementById('logArea');
  const d = document.createElement('div');
  d.className = 'topic-divider';
  d.textContent = '▶ ' + title;
  area.appendChild(d);
  area.scrollTop = area.scrollHeight;
}

function logMsg(agent, isStreaming=false){
  const area = document.getElementById('logArea');
  const div = document.createElement('div');
  div.className = 'log-msg';
  div.id = 'logmsg_' + agent.id;
  div.innerHTML = `
    <div class="log-av" style="background:${agent.bg};color:${agent.color}">${agent.short}</div>
    <div class="log-body">
      <div class="log-header">
        <span class="log-name" style="color:${agent.color}">${agent.name}</span>
        <span class="log-role">${agent.role}</span>
      </div>
      <div class="log-text${isStreaming?' streaming':''}" style="border-color:${agent.color}44"></div>
    </div>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return div.querySelector('.log-text');
}

function logSummary(text){
  const area = document.getElementById('logArea');
  const d = document.createElement('div');
  d.className = 'log-summary';
  d.innerHTML = `<div class="ls-title">✦ 주제 결론</div><div class="ls-body">${text}</div>`;
  area.appendChild(d);
  area.scrollTop = area.scrollHeight;
}

// ─── API call ─────────────────────────────────────────────────────────────────
async function callClaude(system, userMsg){
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': _apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system,
      messages: [{ role:'user', content:userMsg }]
    })
  });
  if(!resp.ok){
    const e = await resp.json().catch(()=>({}));
    throw new Error(e.error?.message || ('HTTP ' + resp.status));
  }
  const data = await resp.json();
  return data.content?.[0]?.text || '(응답 없음)';
}

// ─── Sleep util ───────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Run single topic ─────────────────────────────────────────────────────────
async function runTopic(topic, topicIdx, stepRef, totalSteps){
  setTopicStatus(topicIdx, 'active');
  logDivider(`주제 ${topicIdx+1}: ${topic.title}`);

  // 각 팀에서 팀장 + 사원1 (총 8명) 회의 테이블로 집합
  const PARTICIPANTS_IDS = ['plan0','plan1','sales0','sales1','mkt0','mkt1','cont0','cont1'];
  const participants = PARTICIPANTS_IDS.map(id => AGENTS_DATA.find(a=>a.id===id));

  // 모두 회의 테이블로 이동
  participants.forEach((ag, i) => {
    moveToMeeting(ag.id, i);
    agentStates[ag.id].state = 'meeting';
  });
  // 나머지는 자리에서 working
  AGENTS_DATA.forEach(ag => {
    if(!PARTICIPANTS_IDS.includes(ag.id)){
      agentStates[ag.id].state = 'working';
    }
  });

  await sleep(1800); // 이동 시간

  const history = [];

  // 2라운드 토론
  for(let r=1; r<=2; r++){
    for(const ag of participants){
      stepRef.val++;
      setProgress(Math.round(stepRef.val / totalSteps * 88));

      // 발언 중 표시
      agentStates[ag.id].state = 'thinking';
      showSpeech(ag.id, null, 99999, true); // thinking bubble

      const prev = history.length > 0
        ? '\n\n앞선 발언:\n' + history.slice(-4).join('\n')
        : '';
      const userMsg = r===1
        ? `안건: "${topic.agenda}"\n4DMIXX 차별화 관점에서 당신 역할에 맞는 구체적 전략 의견을 말해주세요. 실행 가능한 아이디어 포함. 200자 이내.${prev}`
        : `안건: "${topic.agenda}"\n앞선 동료 의견을 발전시켜주세요. 특정 동료 이름을 언급하며 대화를 이어가세요. 180자 이내.${prev}`;

      const textEl = logMsg(ag, true);

      try {
        const reply = await callClaude(
          ag.persona + '\n\n규칙: 역할소개없이 바로발언. 이모지절대금지. 4DMIXX실제서비스·납품사례언급권장. 300자이내.',
          userMsg
        );
        textEl.classList.remove('streaming');
        textEl.textContent = reply;
        history.push(`[${ag.name}] ${reply}`);

        // 말풍선 표시 (짧게 요약)
        const bubbleText = reply.length > 55 ? reply.slice(0,53)+'…' : reply;
        agentStates[ag.id].state = 'meeting';
        showSpeech(ag.id, bubbleText, 5000, false);

      } catch(e) {
        textEl.classList.remove('streaming');
        textEl.textContent = `오류: ${e.message}`;
        agentStates[ag.id].state = 'meeting';
        // remove thinking bubble
        const old = document.getElementById('bubble_'+ag.id);
        if(old) old.remove();
      }

      await sleep(400);
    }
  }

  // 결론 정리
  stepRef.val++;
  setProgress(Math.round(stepRef.val / totalSteps * 90));

  const sumMsg = `4DMIXX 전략회의 주제: "${topic.agenda}"

발언 내용:
${history.join('\n\n')}

아래 형식으로 정리:
• 핵심 차별화 전략: (1~2줄)
• 즉시 실행 액션 3가지:
  1.
  2.
  3.
• 팀별 역할:
  - 기획팀:
  - 영업팀:
  - 마케팅팀:
  - 콘텐츠팀:
• 6개월 목표 지표: (수치 포함)`;

  try {
    const sum = await callClaude(
      '4DMIXX 전략 컨설턴트. 실행중심 간결하게 정리. 이모지금지.',
      sumMsg
    );
    logSummary(sum);
  } catch(e){
    logSummary(`결론 정리 오류: ${e.message}`);
  }

  // 모두 자리로 복귀
  participants.forEach(ag => {
    agentStates[ag.id].state = 'idle';
    moveToDesk(ag.id);
    const old = document.getElementById('bubble_'+ag.id);
    if(old) old.remove();
  });
  AGENTS_DATA.forEach(ag => {
    agentStates[ag.id].state = 'idle';
  });

  setTopicStatus(topicIdx, 'done');
  await sleep(1200); // 복귀 시간
}

// ─── Run all topics ───────────────────────────────────────────────────────────
async function runAll(){
  if(_running) return;
  if(!_apiKey){
    alert('먼저 API 키를 입력하고 SAVE 버튼을 눌러주세요.\n\n발급: https://console.anthropic.com/settings/keys');
    return;
  }
  _running = true;
  document.getElementById('runBtn').disabled = true;
  setStatus('running');
  document.getElementById('logArea').innerHTML = '';
  clearAllBubbles();

  // 총 스텝: 주제6 × 라운드2 × 참여8 + 결론6 = 102
  const totalSteps = 102;
  const stepRef = { val: 0 };

  for(let i=0; i<TOPICS.length; i++){
    await runTopic(TOPICS[i], i, stepRef, totalSteps);
    setProgress(Math.round(((i+1)/TOPICS.length)*95));
  }

  setProgress(100);
  setStatus('done');
  _running = false;

  // 완료 이벤트 — 전원 춤추기 (점프 애니메이션)
  AGENTS_DATA.forEach(ag => {
    const s = agentStates[ag.id];
    if(s){ s.state = 'working'; }
  });
  showSpeech('plan0', '전략 회의 완료! 🎯', 4000);
  showSpeech('mkt0',  '실행에 옮겨봅시다!', 4000);
  showSpeech('sales0','수주 늘리겠습니다!', 4000);
  showSpeech('cont0', '콘텐츠 제작 시작!', 4000);
}

// ─── Reset ────────────────────────────────────────────────────────────────────
function resetAll(){
  if(_running) return;
  document.getElementById('logArea').innerHTML = '';
  document.getElementById('runBtn').disabled = false;
  setProgress(0);
  setStatus('idle');
  clearAllBubbles();
  for(let i=0;i<6;i++) setTopicStatus(i,'pending');
  // 모두 자리로
  if(window.agentStates){
    AGENTS_DATA.forEach(ag => {
      const s = agentStates[ag.id];
      const pos = DESK_POSITIONS[ag.id];
      if(s && pos){
        s.tx = pos.tx * TILE + TILE/2;
        s.ty = pos.ty * TILE + TILE/2;
        s.state = 'idle';
      }
    });
  }
}

// ─── Export / Save ────────────────────────────────────────────────────────────

// 회의 결과 수집
function collectResults() {
  const area = document.getElementById('logArea');
  const nodes = area.querySelectorAll('.topic-divider, .log-msg, .log-summary');
  const lines = [];
  const now = new Date().toLocaleString('ko-KR');

  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║         4DMIXX AI 전략 회의 결과 보고서                      ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('생성일시: ' + now);
  lines.push('참여 팀원: 기획팀(3) · 영업팀(3) · 마케팅팀(3) · 콘텐츠팀(3) = 12명');
  lines.push('진행 주제: 6개 전략 주제 자동 회의');
  lines.push('');
  lines.push('━'.repeat(64));
  lines.push('');

  nodes.forEach(node => {
    if (node.classList.contains('topic-divider')) {
      lines.push('');
      lines.push('▶ ' + node.textContent.replace('▶ ', ''));
      lines.push('─'.repeat(50));
    } else if (node.classList.contains('log-msg')) {
      const name = node.querySelector('.log-name')?.textContent || '';
      const role = node.querySelector('.log-role')?.textContent || '';
      const text = node.querySelector('.log-text')?.textContent || '';
      if (text && text !== '(응답 없음)') {
        lines.push(`[${name} / ${role}]`);
        lines.push(text);
        lines.push('');
      }
    } else if (node.classList.contains('log-summary')) {
      const title = node.querySelector('.ls-title')?.textContent || '';
      const body  = node.querySelector('.ls-body')?.textContent || '';
      lines.push('');
      lines.push('┌─ ' + title + ' ─────────────────────────────────');
      body.split('\n').forEach(l => lines.push('│ ' + l));
      lines.push('└' + '─'.repeat(52));
      lines.push('');
    }
  });

  lines.push('');
  lines.push('━'.repeat(64));
  lines.push('© 4DMIXX AI 전략 회의실  |  Powered by Claude API');
  return lines.join('\n');
}

// TXT 저장
function saveAsTxt() {
  const content = collectResults();
  if (!content.includes('[')) {
    alert('저장할 회의 결과가 없습니다.\n먼저 회의를 진행해주세요.');
    return;
  }
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const now  = new Date().toISOString().slice(0,10);
  a.href     = url;
  a.download = `4dmixx_전략회의_${now}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// HTML 보고서 저장
function saveAsHtml() {
  const area = document.getElementById('logArea');
  if (!area.querySelector('.log-msg')) {
    alert('저장할 회의 결과가 없습니다.\n먼저 회의를 진행해주세요.');
    return;
  }
  const now = new Date().toLocaleString('ko-KR');
  let html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>4DMIXX 전략 회의 결과</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e8e8e6;max-width:860px;margin:0 auto;padding:2rem}
  h1{font-size:20px;color:#e94560;border-bottom:2px solid #e94560;padding-bottom:10px;margin-bottom:6px}
  .meta{font-size:12px;color:#666;margin-bottom:2rem}
  .divider{font-size:14px;font-weight:bold;color:#00ff88;margin:2rem 0 .5rem;border-top:1px solid #1a1a3a;padding-top:1rem}
  .msg{display:flex;gap:10px;margin-bottom:12px}
  .av{min-width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold}
  .name{font-size:12px;font-weight:bold;margin-bottom:3px}
  .role{font-size:11px;color:#666;margin-bottom:4px}
  .text{font-size:13px;line-height:1.7;background:#1a1a2e;border-left:3px solid;padding:8px 12px;border-radius:0 6px 6px 6px}
  .summary{background:#0a1628;border:1px solid #e94560;border-radius:8px;padding:14px;margin:1rem 0}
  .summary h3{color:#e94560;font-size:13px;margin-bottom:8px}
  .summary pre{font-size:12px;line-height:1.8;white-space:pre-wrap;color:#e8e8e6}
  .footer{text-align:center;font-size:11px;color:#444;margin-top:3rem;padding-top:1rem;border-top:1px solid #1a1a3a}
</style></head><body>
<h1>4DMIXX AI 전략 회의 결과 보고서</h1>
<div class="meta">생성일시: ${now} &nbsp;|&nbsp; 참여: 12명 (기획·영업·마케팅·콘텐츠팀) &nbsp;|&nbsp; 주제: 6개</div>`;

  const nodes = area.querySelectorAll('.topic-divider, .log-msg, .log-summary');
  nodes.forEach(node => {
    if (node.classList.contains('topic-divider')) {
      html += `<div class="divider">${node.textContent}</div>`;
    } else if (node.classList.contains('log-msg')) {
      const name  = node.querySelector('.log-name')?.textContent || '';
      const role  = node.querySelector('.log-role')?.textContent || '';
      const text  = node.querySelector('.log-text')?.textContent || '';
      const color = node.querySelector('.log-name')?.style?.color || '#aaa';
      const short = node.querySelector('.log-av')?.textContent || '?';
      const bg    = node.querySelector('.log-av')?.style?.background || '#333';
      if (text && text !== '(응답 없음)') {
        html += `<div class="msg">
          <div class="av" style="background:${bg};color:${color}">${short}</div>
          <div><div class="name" style="color:${color}">${name}</div>
          <div class="role">${role}</div>
          <div class="text" style="border-color:${color}55">${text}</div></div></div>`;
      }
    } else if (node.classList.contains('log-summary')) {
      const body = node.querySelector('.ls-body')?.textContent || '';
      html += `<div class="summary"><h3>✦ 주제 결론</h3><pre>${body}</pre></div>`;
    }
  });

  html += `<div class="footer">© 4DMIXX AI 전략 회의실 &nbsp;|&nbsp; Powered by Claude API</div></body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0,10);
  a.href     = url;
  a.download = `4dmixx_전략회의_${date}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initOffice();
  // idle 애니메이션 — 가끔 자리에서 움직이기
  setInterval(() => {
    if(_running) return;
    AGENTS_DATA.forEach(ag => {
      if(Math.random() < 0.08){
        const s = agentStates[ag.id];
        const pos = DESK_POSITIONS[ag.id];
        if(!s || !pos) return;
        // 잠깐 옆으로 이동했다 복귀
        const wobble = (Math.random()-.5)*TILE*1.5;
        s.tx = pos.tx * TILE + TILE/2 + wobble;
        s.ty = pos.ty * TILE + TILE/2;
        setTimeout(() => {
          s.tx = pos.tx * TILE + TILE/2;
          s.ty = pos.ty * TILE + TILE/2;
        }, 1500);
      }
    });
  }, 2500);
});
