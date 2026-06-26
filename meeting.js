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
