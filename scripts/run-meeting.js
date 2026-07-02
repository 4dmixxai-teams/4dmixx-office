// scripts/run-meeting.js
// 4DMIXX 자율 AI 전략 회의 — 2시간마다 자동 실행, 결론 즉시 Flow 보고

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FLOW_TOKEN    = process.env.FLOW_MCP_TOKEN || process.env.FLOW_API_TOKEN;
const PROJECT_ID    = process.env.FLOW_PROJECT_ID || '2916231';
const FLOW_BASE     = 'https://api.flow.team/v1';
const MODEL         = 'claude-haiku-4-5-20251001'; // 비용 최적화

if (!ANTHROPIC_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }
if (!FLOW_TOKEN)    { console.error('❌ FLOW_MCP_TOKEN 없음');    process.exit(1); }

// ─── 시간대별 회의 주제 (KST 기준, 2시간 단위) ────────────────────────────────
const TOPIC_SCHEDULE = [
  { hour:  1, topic: '야간 재고·납기 현황 점검 및 다음날 우선순위 수립' },
  { hour:  3, topic: '새벽 설비 가동률 분석 및 유지보수 일정 최적화' },
  { hour:  5, topic: '오전 생산 시작 전 품질 체크리스트 및 작업 배분' },
  { hour:  7, topic: '오전 업무 시작 준비: 고객 문의 대응 우선순위 정리' },
  { hour:  9, topic: '오전 전략 회의: 당일 견적 목표 및 신규 고객 공략 방안' },
  { hour: 11, topic: '오전 중간 점검: 온라인 채널 반응 분석 및 콘텐츠 개선점' },
  { hour: 13, topic: '점심 이후 B2B 영업 전략: 산업별 타겟 고객사 접근법' },
  { hour: 15, topic: '오후 마케팅 미팅: SNS·포트폴리오 노출 확대 및 브랜딩' },
  { hour: 17, topic: '오후 마감 리뷰: 당일 수주 실적 평가 및 개선 액션' },
  { hour: 19, topic: '저녁 신사업 전략: 의료·항공·자동차 산업 3D프린팅 공략' },
  { hour: 21, topic: '야간 R&D 방향: 신소재·후처리 기술 경쟁력 강화 방안' },
  { hour: 23, topic: '일일 총괄 마감: 성과 정리 및 내일 핵심 과제 설정' },
];

function getTopic() {
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  const entry = TOPIC_SCHEDULE.find(t => t.hour === kstHour)
    || TOPIC_SCHEDULE.reduce((a, b) =>
        Math.abs(b.hour - kstHour) < Math.abs(a.hour - kstHour) ? b : a
      );
  return entry.topic;
}

// ─── 회사 브리핑 (공통) ────────────────────────────────────────────────────────
const BRIEF = `4DMIXX(주식회사 포디믹스) 현황:
- 위치: 대전광역시 유성구
- 서비스: 3D설계·디자인설계, 3D프린팅(SLA·FDM·풀컬러), 시제품개발, 후처리·도색, 금형사출양산
- 강점: 설계→양산 원스톱, 온라인견적(3172건+), 포트폴리오430건+
- 주요 납품: 이원마린(선박모형), 엣지파운드리(센서하우징), 원광에스앤티
- 경쟁사: 한국기술KTech, 링크솔루션, 아이컨택
- 시장: 한국 3D프린팅 2024년 7040억→2033년 4.1조(CAGR 19%)`;

const AGENTS = [
  { name: '김기획', role: '기획팀장',   persona: `4DMIXX 기획팀장 김기획. ${BRIEF}. 전략방향·포지셔닝 전문.` },
  { name: '박영업', role: '영업팀장',   persona: `4DMIXX 영업팀장 박영업. ${BRIEF}. B2B수주·고객관점 전문.` },
  { name: '이마케', role: '마케팅팀장', persona: `4DMIXX 마케팅팀장 이마케. ${BRIEF}. 브랜드·캠페인 전문.` },
  { name: '최콘텐', role: '콘텐츠팀장', persona: `4DMIXX 콘텐츠팀장 최콘텐. ${BRIEF}. SNS·영상전략 전문.` },
];

// ─── Claude API ────────────────────────────────────────────────────────────────
async function callClaude(system, userMsg, maxTokens = 600) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      return d.content?.[0]?.text || '(응답 없음)';
    } catch (e) {
      if (attempt < 2) await sleep(2000 * (attempt + 1));
      else return `(오류: ${e.message})`;
    }
  }
}

// ─── Flow API ─────────────────────────────────────────────────────────────────
async function flowGet(path) {
  const res = await fetch(`${FLOW_BASE}${path}`, {
    headers: { 'x-flow-api-key': FLOW_TOKEN, Accept: 'application/json' },
  });
  return res.json();
}

async function flowPost(path, body) {
  const res = await fetch(`${FLOW_BASE}${path}`, {
    method: 'POST',
    headers: {
      'x-flow-api-key': FLOW_TOKEN,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, ...JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status }; }
}

async function getBotId() {
  const data = await flowGet('/bots');
  const bots = data.response?.data?.bots || data.data?.bots || [];
  return bots[0]?.botId || null;
}

async function postToFlow(botId, title, contents) {
  const r = await flowPost(`/bots/${botId}/posts`, { projectId: PROJECT_ID, title, contents });
  if (r.ok) { console.log('  ✅ Flow 포스트 등록 완료'); return; }
  // 봇이 프로젝트 미참여 시 알림으로 폴백
  console.warn(`  ⚠️  포스트 실패(${r.status}), 알림으로 폴백`);
  await flowPost(`/bots/${botId}/notifications`, { title, contents });
}

// ─── 회의 진행 ────────────────────────────────────────────────────────────────
async function runMeeting(topic) {
  console.log(`\n[회의 주제] ${topic}`);
  const history = [];

  for (const ag of AGENTS) {
    const prevCtx = history.length
      ? `\n\n앞선 발언:\n${history.slice(-2).join('\n')}`
      : '';
    const reply = await callClaude(
      `${ag.persona}\n규칙: 역할소개없이 바로발언. 이모지금지. 150자 이내.`,
      `안건: "${topic}"\n4DMIXX 관점에서 구체적 실행 의견을 말해주세요.${prevCtx}`,
      400,
    );
    history.push(`[${ag.name}/${ag.role}] ${reply}`);
    console.log(`  ${ag.name}: ${reply.slice(0, 60)}...`);
    await sleep(300);
  }

  const summary = await callClaude(
    '4DMIXX 전략 컨설턴트. 간결하고 실행중심. 이모지금지.',
    `안건: "${topic}"\n\n발언:\n${history.join('\n\n')}\n\n` +
    `아래 형식으로 정리:\n` +
    `【핵심전략】 (1~2줄)\n` +
    `【즉시 실행 액션】\n1.\n2.\n3.\n` +
    `【팀별 역할】\n- 기획팀:\n- 영업팀:\n- 마케팅팀:\n- 콘텐츠팀:\n` +
    `【이번 회의 결론】 (1줄)`,
    700,
  );

  return { topic, history, summary };
}

// ─── 보고 텍스트 구성 ─────────────────────────────────────────────────────────
function buildReport(result, nowStr) {
  return [
    `=== 4DMIXX AI 전략 회의 결과 ===`,
    `일시: ${nowStr}`,
    `주제: ${result.topic}`,
    ``,
    `--- 팀별 발언 ---`,
    ...result.history,
    ``,
    `--- 결론 ---`,
    result.summary,
  ].join('\n');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const nowStr = new Date(Date.now() + 9 * 3600000)
    .toISOString().slice(0, 16).replace('T', ' ') + ' KST';
  console.log(`\n4DMIXX 자율 AI 전략 회의 시작 (${nowStr})`);

  const topic = getTopic();

  const botId = await getBotId().catch(e => {
    console.error('getBots 실패:', e.message);
    process.exit(1);
  });
  if (!botId) { console.error('❌ 사용 가능한 봇 없음'); process.exit(1); }

  const result = await runMeeting(topic);
  const report = buildReport(result, nowStr);

  const title = `[AI 회의] ${topic.slice(0, 30)} — ${nowStr}`;
  await postToFlow(botId, title, report);

  console.log('\n✅ 회의 완료 및 Flow 보고 완료');
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
