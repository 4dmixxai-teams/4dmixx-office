// ── flow-meeting.mjs ── Flow 글 감지 → AI 회의 → 댓글+PDF 업로드 ────────────
// GitHub Actions에서 5분마다 실행됨 (cron: */5 * * * *)

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FLOW_TOKEN    = process.env.FLOW_API_TOKEN;
const PROJECT_ID    = process.env.FLOW_PROJECT_ID || '2916231';
const STATE_FILE    = path.join(process.cwd(), 'scripts', '.processed_posts.json');

if (!ANTHROPIC_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }
if (!FLOW_TOKEN)    { console.error('❌ FLOW_API_TOKEN 없음');    process.exit(1); }

// ─── 처리된 게시글 상태 관리 ─────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { processedPosts: {}, processedComments: {} }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Flow API ────────────────────────────────────────────────────────────────
const FLOW_BASE = 'https://api.flow.team/v1';

async function flowRequest(method, path, body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${FLOW_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const url = `${FLOW_BASE}${path}`;
  const r = await fetch(url, opts);
  const text = await r.text();

  if (text.trim().startsWith('<')) {
    throw new Error(`Flow API HTML 응답 (인증 실패 또는 잘못된 엔드포인트): ${method} ${url}\n${text.slice(0, 300)}`);
  }
  if (!text.trim()) return {};

  const data = JSON.parse(text);
  if (!r.ok) {
    throw new Error(`Flow API ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

const flowGet  = (path)       => flowRequest('GET',  path);
const flowPost = (path, body) => flowRequest('POST', path, body);

async function getRecentPosts() {
  const r = await flowGet(`/colabo/${PROJECT_ID}/list?templateType=post&pageSize=20`);
  return r.posts || r.result || r.items || r.data || [];
}

async function getPostComments(postId) {
  const r = await flowGet(`/colabo/${PROJECT_ID}/post/${postId}/remark/list`);
  return r.remarks || r.list || r.items || r.data || [];
}

async function postComment(postId, content, pdfBase64 = null) {
  const body = { content };
  if (pdfBase64) {
    body.files = [{ fileName: `4DMIXX_전략회의_${getTodayStr()}.pdf`, fileContents: pdfBase64 }];
  }
  return flowPost(`/colabo/${PROJECT_ID}/post/${postId}/remark`, body);
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

  // 결론 정리
  const summary = await callClaude(
    '4DMIXX 전략 컨설턴트. 간결하고 실행중심. 이모지금지.',
    `안건: "${agenda}"\n\n발언:\n${history.join('\n\n')}\n\n아래 형식으로 정리:\n• 핵심전략: (1~2줄)\n• 즉시 실행 액션:\n  1.\n  2.\n  3.\n• 팀별 역할:\n  - 기획팀:\n  - 영업팀:\n  - 마케팅팀:\n  - 콘텐츠팀:\n• 6개월 목표:`
  );

  return { agenda, agents: results, summary };
}

// ─── 여러 안건 감지 및 회의 ───────────────────────────────────────────────────
function parseAgendas(content) {
  // 줄바꿈으로 구분된 안건들 파싱
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  // "회의해줘" 같은 명령어 제거
  const filtered = lines.filter(l => !l.match(/^(회의해줘|회의|시작|안건|주제|질문)[\s:：]?$/));
  return filtered.length > 0 ? filtered : [content.trim()];
}

// ─── PDF 생성 (Python) ────────────────────────────────────────────────────────
function generatePdf(meetingResults, dateStr) {
  const tmpJson = `/tmp/meeting_data_${Date.now()}.json`;
  const tmpPdf  = `/tmp/meeting_${Date.now()}.pdf`;
  fs.writeFileSync(tmpJson, JSON.stringify({ results: meetingResults, date: dateStr }));

  const pyScript = `
import json, sys, base64
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT, TA_CENTER

# 한글 폰트 등록
import os
font_paths = [
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
]
font_registered = False
for fp in font_paths:
    if os.path.exists(fp):
        try:
            pdfmetrics.registerFont(TTFont('KR', fp))
            font_registered = True
            break
        except: pass

font = 'KR' if font_registered else 'Helvetica'

with open('${tmpJson}') as f:
    data = json.load(f)

doc = SimpleDocTemplate('${tmpPdf}', pagesize=A4,
    leftMargin=20*mm, rightMargin=20*mm, topMargin=20*mm, bottomMargin=20*mm)

styles = getSampleStyleSheet()
title_style = ParagraphStyle('title', fontName=font, fontSize=16, textColor=colors.HexColor('#e94560'),
    spaceAfter=4, alignment=TA_CENTER)
sub_style   = ParagraphStyle('sub', fontName=font, fontSize=9, textColor=colors.HexColor('#888888'),
    spaceAfter=12, alignment=TA_CENTER)
h2_style    = ParagraphStyle('h2', fontName=font, fontSize=12, textColor=colors.HexColor('#00aa66'),
    spaceBefore=12, spaceAfter=6)
body_style  = ParagraphStyle('body', fontName=font, fontSize=9, textColor=colors.HexColor('#333333'),
    leading=14, spaceAfter=4)
name_style  = ParagraphStyle('name', fontName=font, fontSize=9, textColor=colors.HexColor('#185FA5'),
    spaceBefore=8, spaceAfter=2)
sum_style   = ParagraphStyle('sum', fontName=font, fontSize=9, textColor=colors.HexColor('#111111'),
    leading=15, spaceAfter=4, leftIndent=8)

story = []
story.append(Paragraph('4DMIXX AI 전략 회의 결과', title_style))
story.append(Paragraph(data['date'] + ' | 참여: 기획·영업·마케팅·콘텐츠팀 | Powered by Claude API', sub_style))
story.append(HRFlowable(width='100%', thickness=1.5, color=colors.HexColor('#e94560')))
story.append(Spacer(1, 8))

for i, r in enumerate(data['results']):
    story.append(Paragraph(f"[ 주제 {i+1} ] {r['agenda']}", h2_style))
    story.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#dddddd')))
    story.append(Spacer(1, 4))

    for ag_result in r['agents']:
        story.append(Paragraph(f"{ag_result['agent']['name']} — {ag_result['agent']['role']}", name_style))
        story.append(Paragraph(ag_result['text'], body_style))

    story.append(Spacer(1, 6))
    story.append(Paragraph('[ 결론 ]', ParagraphStyle('concl', fontName=font, fontSize=10,
        textColor=colors.HexColor('#e94560'), spaceBefore=4, spaceAfter=4)))
    for line in r['summary'].split('\\n'):
        if line.strip():
            story.append(Paragraph(line.strip(), sum_style))
    story.append(Spacer(1, 8))

doc.build(story)

with open('${tmpPdf}', 'rb') as f:
    print(base64.b64encode(f.read()).decode())
`;

  try {
    const b64 = execSync(`python3 -c "${pyScript.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, { maxBuffer: 10*1024*1024 }).toString().trim();
    fs.unlinkSync(tmpJson);
    try { fs.unlinkSync(tmpPdf); } catch {}
    return b64;
  } catch (e) {
    console.warn('PDF 생성 실패:', e.message);
    fs.unlinkSync(tmpJson);
    return null;
  }
}

// ─── 댓글 텍스트 생성 ─────────────────────────────────────────────────────────
function buildCommentText(meetingResults, dateStr) {
  let text = `🤖 4DMIXX AI 전략 회의 결과 — ${dateStr}\n`;
  text += '═'.repeat(48) + '\n\n';

  meetingResults.forEach((r, i) => {
    text += `📋 주제 ${i+1}. ${r.agenda}\n`;
    text += '─'.repeat(40) + '\n';
    r.agents.forEach(a => {
      text += `[${a.agent.name}/${a.agent.role}]\n${a.text}\n\n`;
    });
    text += '✦ 결론\n' + r.summary + '\n\n';
  });

  text += '─'.repeat(48) + '\n';
  text += '📎 상세 보고서는 첨부 PDF를 확인해주세요.\n';
  text += '💬 추가 질문이나 새 안건은 댓글로 남겨주시면 바로 회의하겠습니다!';
  return text;
}

// ─── 추가 댓글 질문 처리 ──────────────────────────────────────────────────────
async function handleComment(postId, commentContent, originalPostContent) {
  console.log(`  댓글 질문 처리: ${commentContent.slice(0, 40)}...`);
  const reply = await callClaude(
    `당신은 4DMIXX AI 전략팀 어시스턴트입니다. ${BRIEF}\n규칙: 한국어. 이모지금지. 실용적이고 구체적으로.`,
    `원래 안건: "${originalPostContent}"\n\n추가 질문/요청: "${commentContent}"\n\n위 질문에 대해 4DMIXX 관점에서 구체적이고 실행 가능한 답변을 해주세요. 필요하면 기획·영업·마케팅·콘텐츠팀 관점을 각각 포함해주세요.`,
    1000
  );
  return reply;
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getTodayStr() {
  return new Date(Date.now() + 9*3600000).toISOString().slice(0,10);
}
function getNowStr() {
  return new Date(Date.now() + 9*3600000).toISOString().slice(0,16).replace('T',' ') + ' KST';
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 Flow 프로젝트 ${PROJECT_ID} 조회 중... (${getNowStr()})`);
  const state = loadState();

  // 최근 게시글 조회
  let posts;
  try { posts = await getRecentPosts(); }
  catch (e) { console.error('Flow 조회 실패:', e.message); process.exit(1); }

  console.log(`  게시글 ${posts.length}개 발견`);

  for (const post of posts) {
    const postId   = post.postId || post.id;
    const content  = (post.content || post.title || '').trim();
    const title    = post.title || '';
    const dateTime = post.registeredDateTime || post.createdAt || '';

    if (!postId || !content) continue;

    // ── 새 게시글 처리 ──────────────────────────────────────────────────────
    if (!state.processedPosts[postId]) {
      console.log(`\n📌 새 게시글 발견: [${postId}] ${title}`);
      state.processedPosts[postId] = { processedAt: Date.now(), content };

      // 안건 파싱 (여러 줄 = 여러 안건)
      const agendas = parseAgendas(content);
      console.log(`  안건 ${agendas.length}개 감지`);

      // 회의 진행
      const meetingResults = [];
      for (const agenda of agendas) {
        if (agenda.length < 3) continue;
        const result = await runMeeting(agenda);
        meetingResults.push(result);
        await sleep(500);
      }

      if (meetingResults.length === 0) { saveState(state); continue; }

      const dateStr = getNowStr();

      // PDF 생성
      console.log('  PDF 생성 중...');
      const pdfB64 = generatePdf(meetingResults, dateStr);

      // 댓글 작성
      const commentText = buildCommentText(meetingResults, dateStr);
      console.log('  댓글 업로드 중...');
      await postComment(postId, commentText, pdfB64);
      console.log(`  ✅ 게시글 [${postId}] 처리 완료`);

      saveState(state);
      await sleep(1000);
    }

    // ── 기존 게시글의 새 댓글 처리 ─────────────────────────────────────────
    else {
      let comments;
      try { comments = await getPostComments(postId); }
      catch { continue; }

      const originalContent = state.processedPosts[postId].content || content;

      for (const comment of (comments || [])) {
        const commentId       = comment.COLABO_REMARK_SRNO || comment.remarkId || comment.id;
        const commentContent  = (comment.REMARK_CNTN || comment.CNTN || comment.content || comment.text || '').trim();
        const commentAuthorId = comment.RGSR_ID || comment.registerId || '';
        const commentAuthor   = comment.RGSR_NM || comment.registerName || comment.author || '';

        if (!commentId || !commentContent) continue;
        // 본인(AI봇) 댓글 무시
        if (commentAuthorId === 'flow-bot01@flow.team' || commentAuthor === '4DMIXX AI' || commentContent.includes('🤖 4DMIXX AI')) continue;
        if (state.processedComments[commentId]) continue;

        console.log(`\n💬 새 댓글 발견 [${commentId}]: ${commentContent.slice(0,40)}...`);
        state.processedComments[commentId] = { processedAt: Date.now() };

        const reply = await handleComment(postId, commentContent, originalContent);
        await postComment(postId, `💬 AI 답변\n\n${reply}\n\n─────\n추가 질문은 댓글로 남겨주세요!`);
        console.log(`  ✅ 댓글 [${commentId}] 답변 완료`);

        saveState(state);
        await sleep(500);
      }
    }
  }

  console.log(`\n✅ 완료 — 다음 실행까지 대기`);
}

main().catch(e => { console.error('💥 오류:', e); process.exit(1); });
