// ── flow-meeting.mjs ─────────────────────────────────────────────────────────
// 사용 가능한 API: getBots, createBotPost, createBotNotification, getProjects
// 게시글 수신: Flow 웹훅 → GitHub repository_dispatch → WEBHOOK_PAYLOAD 환경변수
// 결과 게시:  createBotPost (flow_create_post) — 댓글 대신 새 봇 게시글
// getPosts 403 문제로 게시글 직접 조회 완전 제거

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const FLOW_MCP_URL   = 'https://flow.team/ai/mcp';
const FLOW_MCP_TOKEN = process.env.FLOW_MCP_TOKEN;
const PROJECT_ID     = process.env.FLOW_PROJECT_ID || '2916231';
const STATE_FILE     = path.join(process.cwd(), 'scripts', '.processed_posts.json');

if (!ANTHROPIC_KEY)  { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }
if (!FLOW_MCP_TOKEN) { console.error('❌ FLOW_MCP_TOKEN 없음');    process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getNowStr  = () => new Date(Date.now()+9*3600000).toISOString().slice(0,16).replace('T',' ')+' KST';
const getTodayStr = () => new Date(Date.now()+9*3600000).toISOString().slice(0,10);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE,'utf-8')); }
  catch { return { processedPosts:{} }; }
}
function saveState(s) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s,null,2));
}

// ─── 웹훅 페이로드 파싱 ───────────────────────────────────────────────────────
// Cloudflare Worker → GitHub repository_dispatch → client_payload: {title, content, userId}
function parseWebhookPayload(raw) {
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const title   = payload.title   || payload.subject || '';
  const content = (payload.content || payload.body || payload.text || '').trim();
  const userId  = payload.userId  || payload.registerId || '';
  // postId가 없으면 content 해시로 중복 방지
  const postId  = payload.postId  || payload.id || `${Date.now()}_${content.slice(0,20).replace(/\s/g,'_')}`;
  return { postId: String(postId), title, content, writerName: '', writerId: userId, projectId: PROJECT_ID };
}

// ─── stdin 읽기 ───────────────────────────────────────────────────────────────
function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', d => { buf += d; });
    process.stdin.on('end', () => resolve(buf.trim()));
    process.stdin.on('error', reject);
    // stdin이 TTY면(터미널 직접 실행) 바로 빈 문자열 반환
    if (process.stdin.isTTY) resolve('');
  });
}

// ─── Claude + MCP 통합 호출 ───────────────────────────────────────────────────
async function claudeWithMCP(instruction, maxTokens=2000) {
  const messages = [{ role:'user', content: instruction }];
  let result = '';

  for (let turn = 0; turn < 10; turn++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        mcp_servers: [{
          type: 'url',
          url: FLOW_MCP_URL,
          name: 'flow',
          authorization_token: FLOW_MCP_TOKEN
        }],
        messages
      })
    });

    if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0,200)}`);

    const d = await r.json();
    messages.push({ role:'assistant', content: d.content });

    for (const block of d.content) {
      if (block.type === 'text') result += block.text;
    }

    if (d.stop_reason === 'end_turn') break;

    if (d.stop_reason === 'tool_use') {
      const toolResults = d.content
        .filter(b => b.type === 'tool_use')
        .map(b => {
          console.log(`    🔧 ${b.name}(${JSON.stringify(b.input).slice(0,100)})`);
          return { type:'tool_result', tool_use_id:b.id, content:'' };
        });
      if (toolResults.length) messages.push({ role:'user', content: toolResults });
    } else {
      break;
    }
    await sleep(200);
  }
  return result;
}

// ─── 일반 Claude 호출 ─────────────────────────────────────────────────────────
async function callClaude(system, userMsg, maxTokens=800) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'x-api-key':ANTHROPIC_KEY, 'anthropic-version':'2023-06-01' },
        body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:maxTokens, system, messages:[{role:'user',content:userMsg}] })
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return d.content?.[0]?.text || '(응답없음)';
    } catch(e) {
      if (i < 2) await sleep(2000); else return `(오류: ${e.message})`;
    }
  }
}

// ─── 회사 브리핑 & 에이전트 ───────────────────────────────────────────────────
const BRIEF = `4DMIXX(주식회사 포디믹스): 대전 유성구, 3D설계·3D프린팅(SLA·FDM·풀컬러)·시제품개발·후처리·금형사출양산·CNC. 원스톱 강점. 납품: 이원마린·엣지파운드리·육군·뷰티디바이스. 경쟁사: KTech·링크솔루션·아이컨택. 시장: 7040억→4.1조(CAGR19%).`;

const AGENTS = [
  { name:'김기획', role:'기획팀장',   persona:`4DMIXX 기획팀장 김기획. ${BRIEF} 전략·포지셔닝. 한국어 3문장. 이모지금지.` },
  { name:'박영업', role:'영업팀장',   persona:`4DMIXX 영업팀장 박영업. ${BRIEF} B2B수주·고객관점. 한국어 3문장. 이모지금지.` },
  { name:'이마케', role:'마케팅팀장', persona:`4DMIXX 마케팅팀장 이마케. ${BRIEF} 브랜드·채널전략. 한국어 3문장. 이모지금지.` },
  { name:'최콘텐', role:'콘텐츠팀장', persona:`4DMIXX 콘텐츠팀장 최콘텐. ${BRIEF} SNS·영상전략. 한국어 3문장. 이모지금지.` },
];

// ─── 회의 실행 ────────────────────────────────────────────────────────────────
async function runMeeting(agenda) {
  console.log(`  📌 안건: ${agenda.slice(0,60)}`);
  const history = [], results = [];
  for (const ag of AGENTS) {
    const prev = history.length > 0 ? `\n앞선 발언:\n${history.slice(-2).join('\n')}` : '';
    const reply = await callClaude(
      `당신은 ${ag.persona}\n역할소개없이 바로발언. 이모지금지. 200자이내.`,
      `안건: "${agenda}"\n4DMIXX 관점에서 구체적 전략 의견.${prev}`
    );
    history.push(`[${ag.name}] ${reply}`);
    results.push({ agent:ag, text:reply });
    await sleep(300);
  }
  const summary = await callClaude(
    '4DMIXX 전략 컨설턴트. 실행중심 간결하게. 이모지금지.',
    `안건: "${agenda}"\n발언:\n${history.join('\n')}\n\n정리:\n• 핵심전략:\n• 실행 액션:\n  1.\n  2.\n  3.\n• 팀별 역할:\n  - 기획팀:\n  - 영업팀:\n  - 마케팅팀:\n  - 콘텐츠팀:\n• 6개월 목표:`
  );
  return { agenda, agents:results, summary };
}

// ─── 안건 파싱 ────────────────────────────────────────────────────────────────
function parseAgendas(content) {
  const skip = /^(회의해줘|회의|시작|ㅇ|네|예|알겠|확인)\s*$/;
  const lines = content.split('\n').map(l=>l.trim()).filter(l=>l.length>3 && !skip.test(l));
  return lines.length > 0 ? lines : [content.trim()];
}

// ─── PDF 생성 ─────────────────────────────────────────────────────────────────
function generatePdf(meetingResults, dateStr) {
  const tmpJson = `/tmp/md_${Date.now()}.json`;
  const tmpPdf  = `/tmp/mp_${Date.now()}.pdf`;
  fs.writeFileSync(tmpJson, JSON.stringify({ results:meetingResults, date:dateStr }));
  const py = `
import json,base64,os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,HRFlowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_CENTER
for fp in ['/usr/share/fonts/truetype/nanum/NanumGothic.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
    if os.path.exists(fp):
        try: pdfmetrics.registerFont(TTFont('KR',fp)); break
        except: pass
f='KR'
with open('${tmpJson}') as fh: data=json.load(fh)
doc=SimpleDocTemplate('${tmpPdf}',pagesize=A4,leftMargin=20*mm,rightMargin=20*mm,topMargin=20*mm,bottomMargin=20*mm)
T=lambda n,**k:ParagraphStyle(n,fontName=f,**k)
story=[
  Paragraph('4DMIXX AI 전략 회의 결과',T('t',fontSize=16,textColor=colors.HexColor('#e94560'),spaceAfter=4,alignment=TA_CENTER)),
  Paragraph(data['date'],T('s',fontSize=9,textColor=colors.HexColor('#888'),spaceAfter=12,alignment=TA_CENTER)),
  HRFlowable(width='100%',thickness=1.5,color=colors.HexColor('#e94560')),Spacer(1,8)
]
for i,r in enumerate(data['results']):
    story+=[Paragraph(f"주제 {i+1}. {r['agenda']}",T('h',fontSize=12,textColor=colors.HexColor('#00aa66'),spaceBefore=10,spaceAfter=6)),HRFlowable(width='100%',thickness=0.5,color=colors.HexColor('#ddd')),Spacer(1,4)]
    for a in r['agents']:
        story+=[Paragraph(f"{a['agent']['name']} — {a['agent']['role']}",T('n',fontSize=9,textColor=colors.HexColor('#185FA5'),spaceBefore=6,spaceAfter=2)),Paragraph(a['text'],T('b',fontSize=9,textColor=colors.HexColor('#333'),leading=14,spaceAfter=4))]
    story.append(Paragraph('결론',T('c',fontSize=10,textColor=colors.HexColor('#e94560'),spaceBefore=4,spaceAfter=4)))
    [story.append(Paragraph(ln.strip(),T('u',fontSize=9,leading=15,leftIndent=8))) for ln in r['summary'].split('\\n') if ln.strip()]
    story.append(Spacer(1,8))
doc.build(story)
with open('${tmpPdf}','rb') as fh: print(base64.b64encode(fh.read()).decode())
`;
  try {
    const b64 = execSync(
      `python3 -c "${py.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n')}"`,
      { maxBuffer:10*1024*1024 }
    ).toString().trim();
    try { fs.unlinkSync(tmpJson); fs.unlinkSync(tmpPdf); } catch {}
    return b64;
  } catch(e) {
    console.warn('  ⚠️ PDF 실패:', e.message.slice(0,80));
    try { fs.unlinkSync(tmpJson); } catch {}
    return null;
  }
}

// ─── 결과 게시글 텍스트 ───────────────────────────────────────────────────────
function buildPostContent(results, dateStr, originalTitle, writerName) {
  const ref = originalTitle ? `원본 안건: "${originalTitle}"` : '';
  const by  = writerName    ? ` (작성자: ${writerName})` : '';
  let t = `[AI 전략 회의 결과] ${ref}${by}\n생성: ${dateStr}\n${'═'.repeat(44)}\n\n`;
  results.forEach((r,i) => {
    t += `📋 주제 ${i+1}. ${r.agenda}\n${'─'.repeat(36)}\n`;
    r.agents.forEach(a => { t += `[${a.agent.name}/${a.agent.role}]\n${a.text}\n\n`; });
    t += `결론\n${r.summary}\n\n`;
  });
  t += `${'─'.repeat(44)}\n상세 보고서는 첨부 PDF를 확인해주세요.`;
  return t;
}

// ─── createBotPost (MCP) ──────────────────────────────────────────────────────
async function postResult({ projectId, title, content, pdfB64, todayStr }) {
  const params = { projectId, title, content };
  if (pdfB64) {
    params.files = [{ fileName:`4DMIXX_전략회의_${todayStr}.pdf`, fileContents:pdfB64 }];
  }
  const instruction = [
    'flow_create_post 도구를 사용해서 아래 파라미터로 게시글을 작성해줘.',
    '다른 설명 없이 "완료" 또는 "실패"로만 답해줘.',
    '',
    JSON.stringify(params, null, 2)
  ].join('\n');

  console.log('  게시글 작성 중 (createBotPost)...');
  const r = await claudeWithMCP(instruction, 1000);
  console.log('  게시글 작성 결과:', r.slice(0,80));
}

// ─── createBotNotification (MCP) ──────────────────────────────────────────────
async function sendNotification({ projectId, writerId, postId, message }) {
  if (!writerId) return; // 알림 대상 없으면 스킵
  const instruction = [
    'flow_create_notification 도구를 사용해서 아래 파라미터로 알림을 전송해줘.',
    '성공하면 "완료"로만 답해줘.',
    '',
    JSON.stringify({ projectId, targetUserId:writerId, postId, message }, null, 2)
  ].join('\n');

  try {
    console.log('  알림 전송 중 (createBotNotification)...');
    await claudeWithMCP(instruction, 500);
  } catch(e) {
    console.warn('  ⚠️ 알림 전송 실패 (선택사항):', e.message.slice(0,60));
  }
}

// ─── 게시글 1건 처리 ─────────────────────────────────────────────────────────
async function processPost(post, state) {
  const { postId, title, content, writerName, writerId, projectId } = post;

  if (!postId || !content) {
    console.log('  ⚠️ postId 또는 content 없음, 스킵');
    return;
  }
  if (state.processedPosts[postId]) {
    console.log(`  이미 처리된 게시글: ${postId}`);
    return;
  }

  console.log(`\n📌 게시글 처리: [${postId}] ${title || content.slice(0,40)}`);
  state.processedPosts[postId] = { processedAt: Date.now(), content };
  saveState(state);

  const agendas = parseAgendas(content).filter(a => a.length >= 3);
  if (!agendas.length) {
    console.log('  유효한 안건 없음, 스킵');
    return;
  }
  console.log(`  안건 ${agendas.length}개`);

  const meetingResults = [];
  for (const agenda of agendas) {
    meetingResults.push(await runMeeting(agenda));
    await sleep(500);
  }

  const dateStr   = getNowStr();
  const todayStr  = getTodayStr();
  const pdfB64    = generatePdf(meetingResults, dateStr);
  const postTitle = `[AI회의] ${title || agendas[0].slice(0,30)} — ${dateStr}`;
  const postBody  = buildPostContent(meetingResults, dateStr, title, writerName);

  await postResult({ projectId: projectId || PROJECT_ID, title: postTitle, content: postBody, pdfB64, todayStr });

  await sendNotification({
    projectId: projectId || PROJECT_ID,
    writerId,
    postId,
    message: `"${title || agendas[0].slice(0,20)}" 안건의 AI 전략 회의 결과가 게시되었습니다.`
  });

  console.log(`  ✅ [${postId}] 처리 완료`);
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const state = loadState();

  // ── 모드 1: 환경변수로 웹훅 페이로드 수신 (GitHub repository_dispatch 경유) ──
  if (process.env.WEBHOOK_PAYLOAD) {
    console.log(`\n🔔 웹훅 페이로드 수신 (환경변수) — ${getNowStr()}`);
    try {
      const post = parseWebhookPayload(process.env.WEBHOOK_PAYLOAD);
      await processPost(post, state);
    } catch(e) {
      console.error('❌ 페이로드 파싱 실패:', e.message);
      process.exit(1);
    }
    console.log(`\n✅ 완료 (${getNowStr()})`);
    return;
  }

  // ── 모드 2: stdin으로 웹훅 페이로드 수신 ──────────────────────────────────
  if (args.includes('--webhook')) {
    console.log(`\n🔔 웹훅 페이로드 수신 (stdin) — ${getNowStr()}`);
    const raw = await readStdin();
    if (!raw) { console.error('❌ stdin이 비어있음'); process.exit(1); }
    try {
      const post = parseWebhookPayload(raw);
      await processPost(post, state);
    } catch(e) {
      console.error('❌ 페이로드 파싱 실패:', e.message);
      process.exit(1);
    }
    console.log(`\n✅ 완료 (${getNowStr()})`);
    return;
  }

  // ── 모드 3: 직접 실행 (테스트용) ──────────────────────────────────────────
  // node flow-meeting.mjs --content "안건1\n안건2" [--title "제목"] [--post-id "123"]
  const contentIdx = args.indexOf('--content');
  if (contentIdx >= 0) {
    const content  = args[contentIdx + 1] || '';
    const titleIdx = args.indexOf('--title');
    const title    = titleIdx >= 0 ? args[titleIdx + 1] : '';
    const pidIdx   = args.indexOf('--post-id');
    const postId   = pidIdx >= 0 ? args[pidIdx + 1] : `test_${Date.now()}`;
    console.log(`\n🧪 테스트 모드 — ${getNowStr()}`);
    await processPost({ postId, title, content, writerName:'', writerId:'', projectId:PROJECT_ID }, state);
    console.log(`\n✅ 완료 (${getNowStr()})`);
    return;
  }

  // ── 사용법 안내 ────────────────────────────────────────────────────────────
  console.log(`
flow-meeting.mjs — 사용법

  웹훅 (환경변수):
    WEBHOOK_PAYLOAD='{"postId":"123","content":"..."}' node flow-meeting.mjs

  웹훅 (stdin):
    echo '{"postId":"123","content":"..."}' | node flow-meeting.mjs --webhook

  GitHub repository_dispatch 페이로드:
    {"client_payload":{"post":{"postId":"123","title":"...","content":"...","registerName":"홍길동","registerId":"user_id"}}}

  테스트:
    node flow-meeting.mjs --content "전략 안건1\\n전략 안건2" --title "주간 전략 회의"

  필수 환경변수:
    ANTHROPIC_API_KEY, FLOW_MCP_TOKEN, FLOW_PROJECT_ID
`);
}

main().catch(e => { console.error('💥', e.message); process.exit(1); });
