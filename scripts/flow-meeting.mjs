// ── flow-meeting.mjs ── 웹훅으로 게시글 수신 → AI 회의 → createBotPost ────────
// 트리거: Flow 웹훅 → GitHub repository_dispatch → workflow_dispatch (수동 테스트)

import fetch from 'node-fetch';

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const FLOW_TOKEN     = process.env.FLOW_API_TOKEN;
const PROJECT_ID     = process.env.FLOW_PROJECT_ID    || '2916231';
const POST_CONTENT   = process.env.FLOW_POST_CONTENT  || '';
const POST_TITLE     = process.env.FLOW_POST_TITLE    || '회의 요청';
const RECEIVER_ID    = process.env.FLOW_RECEIVER_ID   || '4dmixx@4dmixx.com';

if (!ANTHROPIC_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }
if (!FLOW_TOKEN)    { console.error('❌ FLOW_API_TOKEN 없음');    process.exit(1); }
if (!POST_CONTENT)  { console.error('❌ FLOW_POST_CONTENT 없음 — 웹훅 payload 필요'); process.exit(1); }

// ─── Flow API ────────────────────────────────────────────────────────────────
const FLOW_BASE = 'https://api.flow.team/v1';

async function flowRequest(method, path, body = null) {
  const opts = {
    method,
    headers: {
      'x-flow-api-key': FLOW_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const url = `${FLOW_BASE}${path}`;
  const r = await fetch(url, opts);
  const text = await r.text();

  if (text.trim().startsWith('<')) {
    throw new Error(`Flow API HTML 응답: ${method} ${url}`);
  }
  if (!text.trim()) return { ok: r.ok, status: r.status };

  const data = JSON.parse(text);
  return { ok: r.ok, status: r.status, ...data };
}

async function getBotId() {
  const r = await flowRequest('GET', '/bots');
  const bots = r.response?.data?.bots || r.data?.bots || [];
  return bots[0]?.botId || null;
}

async function createBotPost(botId, title, contents) {
  const r = await flowRequest('POST', `/bots/${botId}/posts`, {
    projectId: PROJECT_ID,
    title,
    contents,
  });
  if (r.status === 412) {
    console.warn('  ⚠️  봇이 프로젝트 참여자가 아님 — 알림으로 폴백');
    return null;
  }
  if (!r.ok) throw new Error(`createBotPost 실패 ${r.status}: ${JSON.stringify(r).slice(0, 200)}`);
  return r;
}

async function createBotNotification(botId, title, contents) {
  const r = await flowRequest('POST', `/bots/${botId}/notifications`, {
    receiverId: RECEIVER_ID,
    title,
    contents,
  });
  if (!r.ok) throw new Error(`createBotNotification 실패 ${r.status}: ${JSON.stringify(r).slice(0, 200)}`);
  return r;
}

// ─── Claude API ───────────────────────────────────────────────────────────────
async function callClaude(system, userMsg, maxTokens = 800) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: userMsg }],
        })
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return d.content?.[0]?.text || '(응답 없음)';
    } catch (e) {
      if (i < 2) await sleep(2000); else return `(오류: ${e.message})`;
    }
  }
}

// ─── 회사 브리핑 ─────────────────────────────────────────────────────────────
const BRIEF = `4DMIXX(주식회사 포디믹스) 현황:
- 위치: 대전광역시 유성구
- 서비스: 3D설계·디자인설계, 3D프린팅(SLA·FDM·풀컬러), 시제품개발, 후처리·도색, 금형사출양산, 진공조형, CNC조각, 레이저커팅
- 강점: 설계→양산 원스톱, 온라인견적(3172건+), 포트폴리오430건+
- 납품: 이원마린(선박모형), 엣지파운드리(센서하우징), 원광에스앤티, 육군홍보세트장, 뷰티디바이스
- 경쟁사: 한국기술KTech, 링크솔루션(ISO9001), 아이컨택, RapidDirect
- 시장: 한국 2024년 7040억→2033년 4.1조(CAGR 19%)`;

const AGENTS = [
  { name:'김기획', role:'기획팀장', persona:`당신은 4DMIXX 기획팀장 김기획. ${BRIEF}. 전략방향·포지셔닝 전문. 한국어 3문장. 이모지금지.` },
  { name:'박영업', role:'영업팀장', persona:`당신은 4DMIXX 영업팀장 박영업. ${BRIEF}. B2B수주·고객관점 전문. 한국어 3문장. 이모지금지.` },
  { name:'이마케', role:'마케팅팀장', persona:`당신은 4DMIXX 마케팅팀장 이마케. ${BRIEF}. 브랜드·캠페인 전문. 한국어 3문장. 이모지금지.` },
  { name:'최콘텐', role:'콘텐츠팀장', persona:`당신은 4DMIXX 콘텐츠팀장 최콘텐. ${BRIEF}. SNS·영상전략 전문. 한국어 3문장. 이모지금지.` },
];

// ─── 단일 안건 회의 ───────────────────────────────────────────────────────────
async function runMeeting(agenda) {
  console.log(`  회의 안건: ${agenda.slice(0, 50)}...`);
  const history = [];
  const results = [];

  for (const ag of AGENTS) {
    const prev = history.length > 0 ? `\n\n앞선 발언:\n${history.slice(-3).join('\n')}` : '';
    const reply = await callClaude(
      ag.persona + '\n규칙: 역할소개없이 바로발언. 이모지금지. 200자이내.',
      `안건: "${agenda}"\n4DMIXX 관점에서 구체적 전략 의견을 말해주세요.${prev}`
    );
    history.push(`[${ag.name}/${ag.role}] ${reply}`);
    results.push({ agent: ag, text: reply });
    await sleep(300);
  }

  const summary = await callClaude(
    '4DMIXX 전략 컨설턴트. 간결하고 실행중심. 이모지금지.',
    `안건: "${agenda}"\n\n발언:\n${history.join('\n\n')}\n\n아래 형식으로 정리:\n• 핵심전략: (1~2줄)\n• 즉시 실행 액션:\n  1.\n  2.\n  3.\n• 팀별 역할:\n  - 기획팀:\n  - 영업팀:\n  - 마케팅팀:\n  - 콘텐츠팀:\n• 6개월 목표:`
  );

  return { agenda, agents: results, summary };
}

// ─── 안건 파싱 ───────────────────────────────────────────────────────────────
function parseAgendas(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  const filtered = lines.filter(l => !l.match(/^(회의해줘|회의|시작|안건|주제|질문)[\s:：]?$/));
  return filtered.length > 0 ? filtered : [content.trim()];
}

// ─── 결과 텍스트 생성 ─────────────────────────────────────────────────────────
function buildResultText(meetingResults, dateStr) {
  let text = `4DMIXX AI 전략 회의 결과 — ${dateStr}\n`;
  text += '='.repeat(48) + '\n\n';

  meetingResults.forEach((r, i) => {
    text += `[주제 ${i+1}] ${r.agenda}\n`;
    text += '-'.repeat(40) + '\n';
    r.agents.forEach(a => {
      text += `[${a.agent.name}/${a.agent.role}]\n${a.text}\n\n`;
    });
    text += '[결론]\n' + r.summary + '\n\n';
  });

  text += '='.repeat(48) + '\n';
  text += `원본 게시글: ${POST_TITLE}`;
  return text;
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getNowStr() {
  return new Date(Date.now() + 9*3600000).toISOString().slice(0,16).replace('T',' ') + ' KST';
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  const dateStr = getNowStr();
  console.log(`\n4DMIXX AI 회의봇 시작 (${dateStr})`);
  console.log(`  게시글: "${POST_TITLE}"`);
  console.log(`  내용 길이: ${POST_CONTENT.length}자`);

  // 봇 ID 조회
  let botId;
  try {
    botId = await getBotId();
    console.log(`  봇 ID: ${botId}`);
  } catch (e) {
    console.error('getBots 실패:', e.message);
    process.exit(1);
  }

  if (!botId) {
    console.error('❌ 사용 가능한 봇 없음');
    process.exit(1);
  }

  // 안건 파싱 및 회의 진행
  const agendas = parseAgendas(POST_CONTENT);
  console.log(`\n  안건 ${agendas.length}개 감지`);

  const meetingResults = [];
  for (const agenda of agendas) {
    if (agenda.length < 3) continue;
    const result = await runMeeting(agenda);
    meetingResults.push(result);
    await sleep(500);
  }

  if (meetingResults.length === 0) {
    console.log('처리할 안건 없음');
    return;
  }

  // 결과 게시
  const title    = `[AI 회의] ${POST_TITLE} — ${dateStr}`;
  const contents = buildResultText(meetingResults, dateStr);

  console.log('\n  결과 게시 중...');

  // 1차 시도: createBotPost (봇이 프로젝트 참여자인 경우)
  let posted = await createBotPost(botId, title, contents);

  // 2차 폴백: createBotNotification
  if (!posted) {
    console.log('  알림으로 결과 전송 중...');
    posted = await createBotNotification(botId, title, contents);
  }

  console.log(`\n✅ 완료 — 안건 ${meetingResults.length}개 처리`);
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
