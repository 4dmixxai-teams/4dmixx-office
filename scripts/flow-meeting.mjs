// ── flow-meeting.mjs ── 웹훅으로 게시글 수신 → AI 회의 → 알림+PDF ────────────
// 트리거: Flow 웹훅 → GitHub repository_dispatch → workflow_dispatch (수동 테스트)
// MEETING_MODE: 'quick' (기본, 1라운드 ~10분) | 'deep' (심층, 6라운드 통합 보고)

import fetch from 'node-fetch';
import fs from 'fs';
import { execSync } from 'child_process';

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const FLOW_TOKEN     = process.env.FLOW_MCP_TOKEN || process.env.FLOW_API_TOKEN;
const PROJECT_ID     = process.env.FLOW_PROJECT_ID    || '2916231';
const POST_CONTENT   = process.env.FLOW_POST_CONTENT  || '';
const POST_TITLE     = process.env.FLOW_POST_TITLE    || '회의 요청';
const RECEIVER_ID    = process.env.FLOW_RECEIVER_ID   || '4dmixx@4dmixx.com';
const PDF_PATH       = process.env.PDF_OUTPUT_PATH    || './meeting-report.pdf';
const RUN_URL        = process.env.ACTIONS_RUN_URL    || '';
const MEETING_MODE   = process.env.MEETING_MODE       || 'quick'; // 'quick' | 'deep'

if (!ANTHROPIC_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }
if (!FLOW_TOKEN)    { console.error('❌ FLOW_MCP_TOKEN 없음');    process.exit(1); }
if (!POST_CONTENT)  { console.error('❌ FLOW_POST_CONTENT 없음 — 웹훅 payload 필요'); process.exit(1); }

// ─── 심층회의 라운드 구성 (deep 모드) ─────────────────────────────────────────
const DEEP_ROUNDS = [
  { label: '1라운드: 현황 파악',   focus: '현재 상황을 파악하고 핵심 문제를 정의해주세요.' },
  { label: '2라운드: 원인 분석',   focus: '문제의 근본 원인과 영향 요소를 심층 분석해주세요.' },
  { label: '3라운드: 해결책 발산', focus: '다양한 해결 방안을 창의적으로 제시해주세요.' },
  { label: '4라운드: 솔루션 선정', focus: '최적의 해결책을 선정하고 구체적인 실행 방법을 설계해주세요.' },
  { label: '5라운드: 리스크 검토', focus: '실행 시 예상되는 리스크와 장애물, 대응 방안을 검토해주세요.' },
  { label: '6라운드: 최종 합의',   focus: '모든 논의를 바탕으로 최종 결론과 즉시 실행 가능한 액션을 확정해주세요.' },
];

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

async function postToFlow(botId, title, contents) {
  const r = await flowRequest('POST', `/bots/${botId}/posts`, {
    projectId: PROJECT_ID,
    title,
    contents,
  });
  if (r.status === 412) {
    console.warn('  ⚠️  봇이 프로젝트 참여자가 아님 — 알림으로 폴백');
    const r2 = await flowRequest('POST', `/bots/${botId}/notifications`, {
      receiverId: RECEIVER_ID,
      title,
      contents,
    });
    if (!r2.ok) throw new Error(`알림 전송 실패 ${r2.status}`);
    return;
  }
  if (!r.ok) throw new Error(`createBotPost 실패 ${r.status}: ${JSON.stringify(r).slice(0, 200)}`);
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

// ─── 단일 라운드 회의 ─────────────────────────────────────────────────────────
async function runRound(agenda, focus, prevSummaries = []) {
  const history = [];
  const results = [];

  const context = prevSummaries.length > 0
    ? `\n\n[이전 라운드 논의 요약]\n${prevSummaries.slice(-2).join('\n---\n')}`
    : '';

  for (const ag of AGENTS) {
    const prev = history.length > 0 ? `\n\n앞선 발언:\n${history.slice(-2).join('\n')}` : '';
    const reply = await callClaude(
      ag.persona + '\n규칙: 역할소개없이 바로발언. 이모지금지. 200자이내.',
      `안건: "${agenda}"\n오늘의 초점: ${focus}${context}${prev}\n\n4DMIXX 관점에서 의견을 말해주세요.`
    );
    history.push(`[${ag.name}/${ag.role}] ${reply}`);
    results.push({ agent: ag, text: reply });
    await sleep(300);
  }

  const summary = await callClaude(
    '4DMIXX 전략 컨설턴트. 간결하고 실행중심. 이모지금지.',
    `안건: "${agenda}" / 초점: ${focus}\n\n발언:\n${history.join('\n\n')}\n\n핵심만 3~5줄로 정리해주세요.`,
    400
  );

  return { agenda, focus, agents: results, summary };
}

// ─── 심층회의 통합 보고서 생성 ────────────────────────────────────────────────
async function buildDeepConsolidation(agenda, rounds) {
  const roundSummaries = rounds.map((r, i) =>
    `[${DEEP_ROUNDS[i].label}]\n${r.summary}`
  ).join('\n\n');

  return callClaude(
    '4DMIXX 최고전략책임자. 복수 회의 라운드를 통합한 최종 전략 보고서 작성. 이모지금지.',
    `주제: "${agenda}"\n\n6라운드 회의 결과:\n${roundSummaries}\n\n` +
    `아래 형식으로 최종 통합 보고서를 작성해주세요:\n\n` +
    `【핵심 결론】\n(2~3줄)\n\n` +
    `【즉시 실행 TOP 3】\n1.\n2.\n3.\n\n` +
    `【팀별 최종 역할】\n- 기획팀:\n- 영업팀:\n- 마케팅팀:\n- 콘텐츠팀:\n\n` +
    `【6개월 목표 및 KPI】\n\n` +
    `【라운드별 핵심 요약】\n` +
    DEEP_ROUNDS.map((rd, i) => `- ${rd.label}: `).join('\n'),
    1200
  );
}

// ─── 안건 파싱 ───────────────────────────────────────────────────────────────
function parseAgendas(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  const filtered = lines.filter(l => !l.match(/^(회의해줘|회의|시작|안건|주제|질문|심층회의|#심층)[\s:：]?$/i));
  return filtered.length > 0 ? filtered : [content.trim()];
}

// ─── PDF 생성 ────────────────────────────────────────────────────────────────
function generatePdf(meetingResults, dateStr, mode, consolidation = null) {
  const tmpJson = '/tmp/meeting_data.json';
  const tmpPy   = '/tmp/generate_pdf.py';

  fs.writeFileSync(tmpJson, JSON.stringify({
    results: meetingResults,
    date: dateStr,
    mode,
    consolidation,
  }));

  fs.writeFileSync(tmpPy, `
import json, os, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_CENTER

font = 'Helvetica'
for fp in [
    '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
]:
    if os.path.exists(fp):
        try:
            pdfmetrics.registerFont(TTFont('KR', fp))
            font = 'KR'
            break
        except: pass

with open(sys.argv[1]) as f:
    data = json.load(f)

doc = SimpleDocTemplate(sys.argv[2], pagesize=A4,
    leftMargin=20*mm, rightMargin=20*mm, topMargin=20*mm, bottomMargin=20*mm)

title_s = ParagraphStyle('t', fontName=font, fontSize=16, textColor=colors.HexColor('#e94560'), spaceAfter=4, alignment=TA_CENTER)
sub_s   = ParagraphStyle('s', fontName=font, fontSize=9,  textColor=colors.HexColor('#888888'), spaceAfter=12, alignment=TA_CENTER)
h2_s    = ParagraphStyle('h', fontName=font, fontSize=12, textColor=colors.HexColor('#00aa66'), spaceBefore=12, spaceAfter=6)
body_s  = ParagraphStyle('b', fontName=font, fontSize=9,  textColor=colors.HexColor('#333333'), leading=14, spaceAfter=4)
name_s  = ParagraphStyle('n', fontName=font, fontSize=9,  textColor=colors.HexColor('#185FA5'), spaceBefore=8, spaceAfter=2)
sum_s   = ParagraphStyle('u', fontName=font, fontSize=9,  textColor=colors.HexColor('#111111'), leading=15, spaceAfter=4, leftIndent=8)
red_s   = ParagraphStyle('r', fontName=font, fontSize=10, textColor=colors.HexColor('#e94560'), spaceBefore=4, spaceAfter=4)

mode_label = '심층 회의 (6라운드)' if data.get('mode') == 'deep' else '일반 회의'
story = [
    Paragraph('4DMIXX AI 전략 회의 결과', title_s),
    Paragraph(data['date'] + f' | {mode_label} | 기획·영업·마케팅·콘텐츠팀', sub_s),
    HRFlowable(width='100%', thickness=1.5, color=colors.HexColor('#e94560')),
    Spacer(1, 8),
]

if data.get('consolidation'):
    story.append(Paragraph('[ 최종 통합 보고서 ]', h2_s))
    story.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#dddddd')))
    for line in data['consolidation'].split('\\n'):
        if line.strip():
            story.append(Paragraph(line.strip(), sum_s))
    story.append(Spacer(1, 12))
    story.append(Paragraph('[ 라운드별 상세 내용 ]', h2_s))
    story.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#dddddd')))
    story.append(Spacer(1, 6))

for i, r in enumerate(data['results']):
    label = r.get('focus', f'안건 {i+1}')
    story += [
        Paragraph(f"[ {label} ]", h2_s),
        HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#dddddd')),
        Spacer(1, 4),
    ]
    for a in r['agents']:
        story += [
            Paragraph(f"{a['agent']['name']} - {a['agent']['role']}", name_s),
            Paragraph(a['text'], body_s),
        ]
    story.append(Spacer(1, 6))
    story.append(Paragraph('[ 라운드 결론 ]', red_s))
    for line in r['summary'].split('\\n'):
        if line.strip():
            story.append(Paragraph(line.strip(), sum_s))
    story.append(Spacer(1, 8))

doc.build(story)
print('ok')
`);

  try {
    const result = execSync(`python3 ${tmpPy} ${tmpJson} ${PDF_PATH}`, {
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim();

    if (result === 'ok' && fs.existsSync(PDF_PATH)) {
      console.log(`  PDF 생성 완료: ${PDF_PATH}`);
      return true;
    }
    console.warn('  PDF 생성 실패: 출력값 =', result);
    return false;
  } catch (e) {
    console.warn('  PDF 생성 실패:', e.stderr?.toString().slice(0, 300) || e.message);
    return false;
  } finally {
    try { fs.unlinkSync(tmpJson); } catch {}
    try { fs.unlinkSync(tmpPy);   } catch {}
  }
}

// ─── 결과 텍스트 생성 ─────────────────────────────────────────────────────────
function buildResultText(meetingResults, dateStr, mode, consolidation = null) {
  const modeLabel = mode === 'deep' ? '심층 회의 (6라운드)' : '일반 회의';
  let text = `4DMIXX AI 전략 회의 결과 — ${dateStr} [${modeLabel}]\n`;
  text += '='.repeat(48) + '\n\n';

  if (consolidation) {
    text += '【최종 통합 보고서】\n';
    text += consolidation + '\n\n';
    text += '='.repeat(48) + '\n';
    text += '【라운드별 상세 내용】\n\n';
  }

  meetingResults.forEach((r, i) => {
    const label = r.focus || `안건 ${i + 1}`;
    text += `[${label}]\n`;
    text += '-'.repeat(40) + '\n';
    r.agents.forEach(a => {
      text += `[${a.agent.name}/${a.agent.role}]\n${a.text}\n\n`;
    });
    text += '[라운드 결론]\n' + r.summary + '\n\n';
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
  const isDeep  = MEETING_MODE === 'deep';
  console.log(`\n4DMIXX AI 회의봇 시작 (${dateStr}) — 모드: ${isDeep ? '심층(6라운드)' : '일반(1라운드)'}`);
  console.log(`  게시글: "${POST_TITLE}"`);

  const botId = await getBotId().catch(e => {
    console.error('getBots 실패:', e.message);
    process.exit(1);
  });
  if (!botId) { console.error('❌ 사용 가능한 봇 없음'); process.exit(1); }

  const agendas = parseAgendas(POST_CONTENT);
  const agenda  = agendas[0]; // 심층회의는 단일 주제에 집중
  console.log(`\n  주제: "${agenda}"`);

  let meetingResults = [];
  let consolidation  = null;

  if (isDeep) {
    // ── 심층 모드: 6라운드 순차 진행 ──────────────────────────────────────────
    console.log('\n  [심층 회의] 6라운드 시작...');
    const prevSummaries = [];

    for (let i = 0; i < DEEP_ROUNDS.length; i++) {
      const round = DEEP_ROUNDS[i];
      console.log(`\n  ${round.label}`);
      const result = await runRound(agenda, round.focus, prevSummaries);
      meetingResults.push(result);
      prevSummaries.push(`${round.label}:\n${result.summary}`);
      await sleep(500);
    }

    // 통합 보고서 생성
    console.log('\n  통합 보고서 생성 중...');
    consolidation = await buildDeepConsolidation(agenda, meetingResults);

  } else {
    // ── 일반 모드: 1라운드 ────────────────────────────────────────────────────
    const result = await runRound(
      agenda,
      '4DMIXX 관점에서 구체적 전략 의견을 말해주세요.'
    );
    meetingResults.push(result);
  }

  // PDF 생성
  console.log('\n  PDF 생성 중...');
  const pdfOk = generatePdf(meetingResults, dateStr, MEETING_MODE, consolidation);

  // 결과 텍스트
  let contents = buildResultText(meetingResults, dateStr, MEETING_MODE, consolidation);
  if (pdfOk && RUN_URL) contents += `\n\n[PDF 보고서 다운로드]\n${RUN_URL}`;

  // Flow에 단 1번 게시
  const modeTag  = isDeep ? '[심층 회의]' : '[AI 회의]';
  const title    = `${modeTag} ${POST_TITLE} — ${dateStr}`;
  console.log('\n  Flow에 결과 게시 중...');
  await postToFlow(botId, title, contents);

  console.log(`\n✅ 완료 — 모드: ${MEETING_MODE}, 라운드: ${meetingResults.length}, PDF: ${pdfOk ? '생성됨' : '실패'}`);
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
