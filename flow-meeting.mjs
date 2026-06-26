// ── flow-meeting.mjs ── Flow MCP 방식으로 글 감지 → AI 회의 → 댓글+PDF ────────
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const FLOW_MCP_URL   = process.env.FLOW_MCP_URL || 'https://flow.team/ai/mcp';
const FLOW_MCP_TOKEN = process.env.FLOW_MCP_TOKEN;
const PROJECT_ID     = process.env.FLOW_PROJECT_ID || '2916231';
const STATE_FILE     = path.join(process.cwd(), 'scripts', '.processed_posts.json');

if (!ANTHROPIC_KEY)  { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }
if (!FLOW_MCP_TOKEN) { console.error('❌ FLOW_MCP_TOKEN 없음');    process.exit(1); }

// ─── 상태 파일 ────────────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { processedPosts: {}, processedComments: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

// ─── Flow MCP 호출 ────────────────────────────────────────────────────────────
async function callFlowMCP(toolName, params) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    tools: [{ type: 'mcp', server_url: FLOW_MCP_URL, server_auth: { type: 'api_key', api_key: FLOW_MCP_TOKEN } }],
    messages: [{ role: 'user', content: `Call the tool ${toolName} with these parameters: ${JSON.stringify(params)}. Return only the raw tool result as JSON.` }]
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Anthropic API error: ${r.status}`);
  const d = await r.json();

  // tool_result 블록에서 데이터 추출
  for (const block of d.content || []) {
    if (block.type === 'tool_result' || block.type === 'mcp_tool_result') {
      try { return JSON.parse(block.content?.[0]?.text || block.content || '{}'); }
      catch { return block.content?.[0]?.text || block.content || {}; }
    }
  }
  // text 블록에서 JSON 추출 시도
  for (const block of d.content || []) {
    if (block.type === 'text') {
      try {
        const match = block.text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
      } catch {}
    }
  }
  return {};
}

// ─── Flow 게시글 목록 조회 ────────────────────────────────────────────────────
async function getRecentPosts() {
  const result = await callFlowMCP('flow_list_project_items', {
    projectId: PROJECT_ID, templateType: 'post', pageSize: '20'
  });
  return result.posts || result.items || result.data || [];
}

// ─── Flow 댓글 목록 조회 ─────────────────────────────────────────────────────
async function getComments(postId) {
  const result = await callFlowMCP('flow_list_project_items', {
    projectId: PROJECT_ID, templateType: 'post', postId
  });
  return result.comments || result.posts || result.items || [];
}

// ─── Flow 댓글 작성 ──────────────────────────────────────────────────────────
async function postComment(postId, content, pdfBase64 = null) {
  const params = { projectId: PROJECT_ID, postId, content };
  if (pdfBase64) {
    params.files = [{ fileName: `4DMIXX_전략회의_${getTodayStr()}.pdf`, fileContents: pdfBase64 }];
  }
  return callFlowMCP('flow_create_comment', params);
}

// ─── Claude API (일반 텍스트) ────────────────────────────────────────────────
async function callClaude(system, userMsg, maxTokens = 800) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMsg }] })
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return d.content?.[0]?.text || '(응답 없음)';
    } catch (e) {
      if (i < 2) await sleep(2000); else return `(오류: ${e.message})`;
    }
  }
}

// ─── 회사 브리핑 + 팀원 ──────────────────────────────────────────────────────
const BRIEF = `4DMIXX(주식회사 포디믹스): 대전 유성구, 3D설계·3D프린팅(SLA·FDM·풀컬러)·시제품개발·후처리·금형사출양산·CNC. 원스톱 강점. 납품: 이원마린·엣지파운드리·육군·뷰티디바이스. 경쟁사: KTech·링크솔루션·아이컨택. 시장: 7040억→4.1조(CAGR19%).`;

const AGENTS = [
  { name:'김기획', role:'기획팀장',   persona:`4DMIXX 기획팀장 김기획. ${BRIEF} 전략·포지셔닝 전문. 한국어 3문장. 이모지금지.` },
  { name:'박영업', role:'영업팀장',   persona:`4DMIXX 영업팀장 박영업. ${BRIEF} B2B수주·고객관점. 한국어 3문장. 이모지금지.` },
  { name:'이마케', role:'마케팅팀장', persona:`4DMIXX 마케팅팀장 이마케. ${BRIEF} 브랜드·채널전략. 한국어 3문장. 이모지금지.` },
  { name:'최콘텐', role:'콘텐츠팀장', persona:`4DMIXX 콘텐츠팀장 최콘텐. ${BRIEF} SNS·영상전략. 한국어 3문장. 이모지금지.` },
];

// ─── 회의 실행 ────────────────────────────────────────────────────────────────
async function runMeeting(agenda) {
  console.log(`  📌 안건: ${agenda.slice(0,50)}`);
  const history = [], results = [];
  for (const ag of AGENTS) {
    const prev = history.length > 0 ? `\n앞선 발언:\n${history.slice(-2).join('\n')}` : '';
    const reply = await callClaude(
      `당신은 ${ag.persona}\n규칙: 역할소개없이 바로발언. 이모지금지. 200자이내.`,
      `안건: "${agenda}"\n4DMIXX 관점에서 구체적 전략 의견을 말해주세요.${prev}`
    );
    history.push(`[${ag.name}] ${reply}`);
    results.push({ agent: ag, text: reply });
    await sleep(300);
  }
  const summary = await callClaude(
    '4DMIXX 전략 컨설턴트. 실행중심 간결하게. 이모지금지.',
    `안건: "${agenda}"\n발언:\n${history.join('\n')}\n\n정리:\n• 핵심전략:\n• 실행 액션:\n  1.\n  2.\n  3.\n• 팀별 역할:\n  - 기획팀:\n  - 영업팀:\n  - 마케팅팀:\n  - 콘텐츠팀:\n• 6개월 목표:`
  );
  return { agenda, agents: results, summary };
}

// ─── 안건 파싱 ────────────────────────────────────────────────────────────────
function parseAgendas(content) {
  const skip = /^(회의해줘|회의|시작|ㅇ|네|예|알겠|확인)[\s]*$/;
  const lines = content.split('\n').map(l=>l.trim()).filter(l=>l.length>3 && !skip.test(l));
  return lines.length > 0 ? lines : [content.trim()];
}

// ─── PDF 생성 ─────────────────────────────────────────────────────────────────
function generatePdf(meetingResults, dateStr) {
  const tmpJson = `/tmp/md_${Date.now()}.json`;
  const tmpPdf  = `/tmp/mp_${Date.now()}.pdf`;
  fs.writeFileSync(tmpJson, JSON.stringify({ results: meetingResults, date: dateStr }));

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
T=lambda n,**k: ParagraphStyle(n,fontName=f,**k)
tS=T('t',fontSize=16,textColor=colors.HexColor('#e94560'),spaceAfter=4,alignment=TA_CENTER)
sS=T('s',fontSize=9,textColor=colors.HexColor('#888'),spaceAfter=12,alignment=TA_CENTER)
h2=T('h2',fontSize=12,textColor=colors.HexColor('#00aa66'),spaceBefore=10,spaceAfter=6)
bo=T('bo',fontSize=9,textColor=colors.HexColor('#333'),leading=14,spaceAfter=4)
nm=T('nm',fontSize=9,textColor=colors.HexColor('#185FA5'),spaceBefore=6,spaceAfter=2)
su=T('su',fontSize=9,textColor=colors.HexColor('#111'),leading=15,spaceAfter=3,leftIndent=8)
story=[Paragraph('4DMIXX AI 전략 회의 결과',tS),Paragraph(data['date'],sS),HRFlowable(width='100%',thickness=1.5,color=colors.HexColor('#e94560')),Spacer(1,8)]
for i,r in enumerate(data['results']):
    story+=[Paragraph(f"[ 주제 {i+1} ] {r['agenda']}",h2),HRFlowable(width='100%',thickness=0.5,color=colors.HexColor('#ddd')),Spacer(1,4)]
    for a in r['agents']:
        story+=[Paragraph(f"{a['agent']['name']} — {a['agent']['role']}",nm),Paragraph(a['text'],bo)]
    story+=[Spacer(1,4),Paragraph('[ 결론 ]',T('c',fontSize=10,textColor=colors.HexColor('#e94560'),spaceBefore=4,spaceAfter=4))]
    for ln in r['summary'].split('\\n'):
        if ln.strip(): story.append(Paragraph(ln.strip(),su))
    story.append(Spacer(1,8))
doc.build(story)
with open('${tmpPdf}','rb') as fh: print(base64.b64encode(fh.read()).decode())
`;
  try {
    const b64 = execSync(`python3 -c "${py.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n')}"`,
      {maxBuffer:10*1024*1024}).toString().trim();
    try { fs.unlinkSync(tmpJson); fs.unlinkSync(tmpPdf); } catch {}
    return b64;
  } catch(e) {
    console.warn('  ⚠️ PDF 생성 실패:', e.message.slice(0,100));
    try { fs.unlinkSync(tmpJson); } catch {}
    return null;
  }
}

// ─── 댓글 텍스트 ─────────────────────────────────────────────────────────────
function buildComment(results, dateStr) {
  let t = `🤖 4DMIXX AI 전략 회의 결과 — ${dateStr}\n${'═'.repeat(44)}\n\n`;
  results.forEach((r,i) => {
    t += `📋 주제 ${i+1}. ${r.agenda}\n${'─'.repeat(36)}\n`;
    r.agents.forEach(a => { t += `[${a.agent.name}/${a.agent.role}]\n${a.text}\n\n`; });
    t += `✦ 결론\n${r.summary}\n\n`;
  });
  t += `${'─'.repeat(44)}\n📎 상세 보고서는 첨부 PDF를 확인해주세요.\n💬 추가 질문은 댓글로 남겨주시면 바로 답변합니다!`;
  return t;
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getTodayStr = () => new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const getNowStr   = () => new Date(Date.now()+9*3600000).toISOString().slice(0,16).replace('T',' ')+' KST';

// ─── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 Flow 프로젝트 ${PROJECT_ID} 조회 중... (${getNowStr()})`);
  const state = loadState();

  let posts;
  try { posts = await getRecentPosts(); }
  catch(e) { console.error('Flow 조회 실패:', e.message); process.exit(1); }
  console.log(`  게시글 ${posts.length}개 발견`);

  for (const post of posts) {
    const postId  = post.postId || post.id;
    const content = (post.content || '').trim();
    const title   = post.title || '';
    if (!postId || !content) continue;

    // 새 게시글
    if (!state.processedPosts[postId]) {
      console.log(`\n📌 새 게시글: [${postId}] ${title}`);
      state.processedPosts[postId] = { processedAt: Date.now(), content };

      const agendas = parseAgendas(content);
      console.log(`  안건 ${agendas.length}개`);

      const meetingResults = [];
      for (const agenda of agendas) {
        if (agenda.length < 3) continue;
        meetingResults.push(await runMeeting(agenda));
        await sleep(500);
      }
      if (!meetingResults.length) { saveState(state); continue; }

      const dateStr = getNowStr();
      console.log('  PDF 생성 중...');
      const pdfB64 = generatePdf(meetingResults, dateStr);
      console.log('  댓글 업로드 중...');
      await postComment(postId, buildComment(meetingResults, dateStr), pdfB64);
      console.log(`  ✅ 완료`);
      saveState(state);
      await sleep(1000);
    }

    // 기존 게시글 새 댓글 감지
    else {
      const originalContent = state.processedPosts[postId].content || content;
      let comments;
      try { comments = await getComments(postId); } catch { continue; }

      for (const c of (comments || [])) {
        const cId      = c.remarkId || c.id;
        const cContent = (c.content || c.text || '').trim();
        const cAuthor  = c.registerName || '';
        if (!cId || !cContent) continue;
        if (cAuthor.includes('AI') || cContent.includes('🤖')) continue;
        if (state.processedComments[cId]) continue;

        console.log(`\n💬 새 댓글 [${cId}]: ${cContent.slice(0,40)}`);
        state.processedComments[cId] = { processedAt: Date.now() };

        const reply = await callClaude(
          `당신은 4DMIXX AI 전략팀 어시스턴트. ${BRIEF} 한국어. 이모지금지. 실용적이고 구체적으로.`,
          `원래 안건: "${originalContent}"\n추가 질문: "${cContent}"\n4DMIXX 관점에서 기획·영업·마케팅·콘텐츠 팀 관점을 포함해 구체적으로 답변해주세요.`,
          1000
        );
        await postComment(postId, `💬 AI 답변\n\n${reply}\n\n─\n추가 질문은 댓글로 남겨주세요!`);
        console.log(`  ✅ 댓글 답변 완료`);
        saveState(state);
        await sleep(500);
      }
    }
  }
  console.log(`\n✅ 완료`);
}

main().catch(e => { console.error('💥', e.message); process.exit(1); });
