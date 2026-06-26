// scripts/run-meeting.js
// GitHub Actions에서 실행되는 서버사이드 회의 자동화 스크립트

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY 환경변수가 없습니다.'); process.exit(1); }

// ─── 회사 브리핑 ──────────────────────────────────────────────────────────────
const BRIEF = `4DMIXX(주식회사 포디믹스) 현황:
- 위치: 대전광역시 유성구 (대전·충청 제조 거점)
- 서비스: 3D설계·디자인설계, 3D프린팅(SLA·FDM·풀컬러), 시제품개발, 후처리·도색, 금형사출양산, 진공조형, CNC조각, 레이저커팅, 교육·행사
- 강점: 설계→출력→후처리→양산 원스톱, 온라인실시간견적(3172건+), 포트폴리오430건+
- 납품: 이원마린(선박전시모형), 엣지파운드리(감지센서), 원광에스앤티(친환경제품), 육군홍보세트장, 뷰티디바이스프로토타입
- 경쟁사: 한국기술KTech(안양), 링크솔루션(ISO9001), 아이컨택(온라인대행), RapidDirect(글로벌)
- 시장: 한국 2024년 7040억→2033년 4.1조(CAGR 19%)`;

// ─── 팀원 ─────────────────────────────────────────────────────────────────────
const AGENTS = [
  { id:'plan0',  name:'김기획', role:'기획팀장',     short:'기획',
    persona:`당신은 4DMIXX 기획팀장 김기획. ${BRIEF}. 역할: 전략방향·포지셔닝·BM구조화. 치밀하고 데이터기반. 한국어 3~4문장. 이모지금지.` },
  { id:'plan1',  name:'정분석', role:'기획팀 사원',  short:'분석',
    persona:`당신은 4DMIXX 기획팀 사원 정분석. ${BRIEF}. 역할: 시장조사·경쟁사분석·데이터근거. 수치중심. 한국어 2~3문장. 이모지금지.` },
  { id:'sales0', name:'박영업', role:'영업팀장',     short:'영업',
    persona:`당신은 4DMIXX 영업팀장 박영업. ${BRIEF}. 역할: B2B수주·파트너·현장고객관점. 솔직하고 현실적. 한국어 3~4문장. 이모지금지.` },
  { id:'sales1', name:'오수주', role:'영업팀 사원',  short:'수주',
    persona:`당신은 4DMIXX 영업팀 사원 오수주. ${BRIEF}. 역할: 신규고객발굴·견적상담·리드관리. 적극적. 한국어 2~3문장. 이모지금지.` },
  { id:'mkt0',   name:'이마케', role:'마케팅팀장',   short:'마케',
    persona:`당신은 4DMIXX 마케팅팀장 이마케. ${BRIEF}. 역할: 브랜드포지셔닝·캠페인기획·채널전략. 트렌드민감. 한국어 3~4문장. 이모지금지.` },
  { id:'mkt1',   name:'윤퍼포', role:'마케팅팀 사원', short:'광고',
    persona:`당신은 4DMIXX 마케팅팀 사원 윤퍼포. ${BRIEF}. 역할: 온라인광고·퍼포먼스·ROAS. 수치중심. 한국어 2~3문장. 이모지금지.` },
  { id:'cont0',  name:'최콘텐', role:'콘텐츠팀장',   short:'콘텐',
    persona:`당신은 4DMIXX 콘텐츠팀장 최콘텐. ${BRIEF}. 역할: SNS전략·영상기획·포트폴리오바이럴화. 실행력강조. 한국어 3~4문장. 이모지금지.` },
  { id:'cont1',  name:'류영상', role:'콘텐츠팀 사원', short:'영상',
    persona:`당신은 4DMIXX 콘텐츠팀 사원 류영상. ${BRIEF}. 역할: 유튜브기획·쇼츠·타임랩스. 영상포맷전문. 한국어 2~3문장. 이모지금지.` },
];

// ─── 6주제 ────────────────────────────────────────────────────────────────────
const TOPICS = [
  { id:0, title:'원스톱 풀서비스 차별화',
    agenda:'설계→출력→후처리→양산 원스톱 서비스로 경쟁사(한국기술·링크솔루션·아이컨택) 대비 차별화 전략.' },
  { id:1, title:'로컬 B2B 파트너십',
    agenda:'대전·충청권 제조 스타트업·중소기업 특화 로컬 파트너십 전략. 대전 테크노파크·KAIST·충남 제조업 클러스터 협력 방안.' },
  { id:2, title:'SNS 바이럴 전략',
    agenda:'3D프린팅 제작과정·포트폴리오(선박모형·뷰티디바이스·육군세트) SNS 바이럴 및 유튜브 콘텐츠로 온라인 인지도 확장.' },
  { id:3, title:'산업군 버티컬 확장',
    agenda:'이원마린(선박)·뷰티디바이스·군납 등 기존 납품 산업군 기반 버티컬 특화 및 신규 고단가 산업군(항공·의료·스마트팩토리) 수주 전략.' },
  { id:4, title:'온라인 견적 고도화',
    agenda:'온라인 견적 시스템(3172건+) 고도화로 전환율 개선 및 재방문 고객 증가 전략. 견적→수주 자동화, UX개선, 리타겟팅.' },
  { id:5, title:'AI설계 프리미엄화',
    agenda:'AI·생성형 설계 도입으로 디자인 역량 차별화 및 고단가 프리미엄 3D디자인 서비스 구축. 경쟁사가 못하는 영역 선점.' },
];

// ─── Claude API 호출 ──────────────────────────────────────────────────────────
async function callClaude(system, userMsg, retries=3) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 700,
          system,
          messages: [{ role: 'user', content: userMsg }]
        })
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error?.message || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      return data.content?.[0]?.text || '(응답 없음)';
    } catch (e) {
      console.warn(`  ⚠️  재시도 ${i+1}/${retries}: ${e.message}`);
      if (i < retries-1) await sleep(2000);
      else return `(오류: ${e.message})`;
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── 주제별 회의 실행 ─────────────────────────────────────────────────────────
async function runTopic(topic) {
  console.log(`\n📋 주제 ${topic.id+1}: ${topic.title}`);
  const history = [];
  const messages = [];

  for (let r = 1; r <= 2; r++) {
    console.log(`  라운드 ${r}`);
    for (const ag of AGENTS) {
      const prev = history.length > 0
        ? '\n\n앞선 발언:\n' + history.slice(-4).join('\n') : '';
      const userMsg = r === 1
        ? `안건: "${topic.agenda}"\n4DMIXX 차별화 관점에서 구체적 전략 의견을 말해주세요. 200자 이내.${prev}`
        : `안건: "${topic.agenda}"\n앞선 동료 의견을 발전시켜주세요. 동료 이름 언급하며 이어가세요. 180자 이내.${prev}`;

      process.stdout.write(`    ${ag.name}(${ag.role}) 발언 중...`);
      const reply = await callClaude(
        ag.persona + '\n\n규칙: 역할소개없이 바로발언. 이모지절대금지. 4DMIXX실제서비스·납품사례언급권장.',
        userMsg
      );
      console.log(' ✓');
      history.push(`[${ag.name}/${ag.role}] ${reply}`);
      messages.push({ agent: ag, round: r, text: reply });
      await sleep(300);
    }
  }

  // 결론 정리
  process.stdout.write(`  결론 정리 중...`);
  const sumMsg = `4DMIXX 전략회의 주제: "${topic.agenda}"

발언:
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

  const summary = await callClaude('4DMIXX 전략 컨설턴트. 실행중심 간결하게. 이모지금지.', sumMsg);
  console.log(' ✓');

  return { topic, messages, summary };
}

// ─── 결과 HTML 생성 ───────────────────────────────────────────────────────────
function buildHtml(results, dateStr) {
  const agentColors = {
    plan0:'#7eb3ff', plan1:'#5a9ae6',
    sales0:'#6dcc8f', sales1:'#4db870',
    mkt0:'#f5c842', mkt1:'#d4a830',
    cont0:'#f07ab0', cont1:'#d45e8e',
  };
  const agentBg = {
    plan0:'#1a3a6e', plan1:'#122a55',
    sales0:'#1a3d25', sales1:'#112d1c',
    mkt0:'#3d2a00', mkt1:'#2e1f00',
    cont0:'#3d1228', cont1:'#2d0d1e',
  };

  let body = '';
  results.forEach(({ topic, messages, summary }) => {
    body += `<section>
      <h2>주제 ${topic.id+1}: ${topic.title}</h2>
      <p class="agenda">${topic.agenda}</p>`;

    messages.forEach(({ agent, round, text }) => {
      body += `<div class="msg">
        <div class="av" style="background:${agentBg[agent.id]||'#222'};color:${agentColors[agent.id]||'#aaa'}">${agent.short}</div>
        <div class="mbody">
          <div class="mhead">
            <span class="mname" style="color:${agentColors[agent.id]||'#aaa'}">${agent.name}</span>
            <span class="mrole">${agent.role}</span>
            <span class="mround">R${round}</span>
          </div>
          <div class="mtext" style="border-color:${agentColors[agent.id]||'#aaa'}44">${text}</div>
        </div>
      </div>`;
    });

    body += `<div class="summary">
      <div class="stitle">✦ 주제 결론</div>
      <pre class="sbody">${summary}</pre>
    </div></section>`;
  });

  return `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>4DMIXX AI 전략 회의 — ${dateStr}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans KR',sans-serif;background:#0a0a14;color:#e8e8e6;max-width:900px;margin:0 auto;padding:2rem 1.5rem}
  header{border-bottom:2px solid #e94560;padding-bottom:1rem;margin-bottom:2rem}
  h1{font-size:22px;color:#e94560;margin-bottom:6px}
  .meta{font-size:12px;color:#555}
  .meta span{color:#888;margin-right:12px}
  section{margin-bottom:3rem;padding:1.5rem;background:#111;border-radius:10px;border:1px solid #1a1a2e}
  h2{font-size:15px;color:#00ff88;margin-bottom:6px}
  .agenda{font-size:12px;color:#555;margin-bottom:1.2rem;padding-bottom:.8rem;border-bottom:1px solid #1a1a2e}
  .msg{display:flex;gap:10px;margin-bottom:14px}
  .av{min-width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;margin-top:2px}
  .mbody{flex:1}
  .mhead{display:flex;align-items:baseline;gap:6px;margin-bottom:4px}
  .mname{font-size:13px;font-weight:700}
  .mrole{font-size:11px;color:#555}
  .mround{font-size:10px;color:#333;margin-left:auto}
  .mtext{font-size:13px;line-height:1.7;background:#0d0d1e;padding:9px 13px;border-left:3px solid;border-radius:0 8px 8px 8px}
  .summary{background:#0a1628;border:1px solid #e9456044;border-radius:8px;padding:14px;margin-top:1rem}
  .stitle{font-size:12px;font-weight:700;color:#e94560;margin-bottom:8px}
  .sbody{font-size:12px;line-height:1.9;white-space:pre-wrap;color:#ccc}
  footer{text-align:center;font-size:11px;color:#333;margin-top:3rem;padding-top:1rem;border-top:1px solid #1a1a2e}
  .toc{background:#111;border:1px solid #1a1a2e;border-radius:8px;padding:1rem 1.5rem;margin-bottom:2rem}
  .toc h3{font-size:12px;color:#555;margin-bottom:8px}
  .toc a{display:block;font-size:13px;color:#00ff88;text-decoration:none;padding:3px 0}
  .toc a:hover{color:#fff}
</style>
</head><body>
<header>
  <h1>4DMIXX AI 전략 회의 결과</h1>
  <div class="meta">
    <span>📅 ${dateStr}</span>
    <span>👥 참여 8명</span>
    <span>📋 6개 주제</span>
    <span>🤖 Powered by Claude API</span>
  </div>
</header>
<div class="toc">
  <h3>목차</h3>
  ${results.map(r=>`<a href="#topic${r.topic.id}">주제 ${r.topic.id+1}: ${r.topic.title}</a>`).join('')}
</div>
${results.map(r => `<div id="topic${r.topic.id}">${body.split('<section>')[r.topic.id+1]?.split('</section>')[0]||''}</section>`).join('')}
<footer>© 4DMIXX AI 전략 회의실 — 자동 생성됨 ${dateStr}</footer>
</body></html>`;
}

// ─── TXT 결과 생성 ─────────────────────────────────────────────────────────────
function buildTxt(results, dateStr) {
  const lines = [];
  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║         4DMIXX AI 전략 회의 결과 보고서                      ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push(`생성일시: ${dateStr}`);
  lines.push('참여: 기획팀(2) · 영업팀(2) · 마케팅팀(2) · 콘텐츠팀(2) = 8명');
  lines.push('');

  results.forEach(({ topic, messages, summary }) => {
    lines.push('');
    lines.push('▶ 주제 ' + (topic.id+1) + ': ' + topic.title);
    lines.push('─'.repeat(60));
    messages.forEach(({ agent, round, text }) => {
      lines.push(`[R${round}] ${agent.name}(${agent.role})`);
      lines.push(text);
      lines.push('');
    });
    lines.push('┌─ 결론 ' + '─'.repeat(53));
    summary.split('\n').forEach(l => lines.push('│ ' + l));
    lines.push('└' + '─'.repeat(60));
  });

  lines.push('');
  lines.push('━'.repeat(60));
  lines.push('© 4DMIXX AI 전략 회의실 | Powered by Claude API');
  return lines.join('\n');
}

// ─── 메인 실행 ────────────────────────────────────────────────────────────────
async function main() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9*60*60*1000);
  const dateStr = kst.toISOString().slice(0,10);
  const dateTimeStr = kst.toISOString().slice(0,16).replace('T',' ') + ' KST';

  console.log('🚀 4DMIXX AI 전략 회의 시작');
  console.log(`📅 날짜: ${dateTimeStr}`);
  console.log(`📋 주제: ${TOPICS.length}개  👥 팀원: ${AGENTS.length}명\n`);

  const results = [];
  for (const topic of TOPICS) {
    const result = await runTopic(topic);
    results.push(result);
    await sleep(1000);
  }

  // results 디렉토리 생성
  const resultsDir = path.join(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

  // 오늘 날짜 디렉토리
  const todayDir = path.join(resultsDir, dateStr);
  if (!fs.existsSync(todayDir)) fs.mkdirSync(todayDir);

  // HTML 저장
  const htmlContent = buildHtml(results, dateTimeStr);
  fs.writeFileSync(path.join(todayDir, 'report.html'), htmlContent, 'utf-8');

  // TXT 저장
  const txtContent = buildTxt(results, dateTimeStr);
  fs.writeFileSync(path.join(todayDir, 'report.txt'), txtContent, 'utf-8');

  // 최신 결과를 results/latest.html 에도 복사
  fs.writeFileSync(path.join(resultsDir, 'latest.html'), htmlContent, 'utf-8');
  fs.writeFileSync(path.join(resultsDir, 'latest.txt'),  txtContent,  'utf-8');

  // 결과 인덱스 업데이트
  updateIndex(resultsDir, dateStr, dateTimeStr);

  console.log('\n✅ 완료!');
  console.log(`📁 저장 위치: results/${dateStr}/report.html`);
  console.log(`🌐 GitHub Pages: https://4dmixxai.github.io/4dmixx-office/results/latest.html`);
}

// ─── 인덱스 페이지 업데이트 ───────────────────────────────────────────────────
function updateIndex(resultsDir, newDate, dateTimeStr) {
  const indexPath = path.join(resultsDir, 'index.html');
  let entries = [];

  // 기존 날짜 목록 수집
  const dirs = fs.readdirSync(resultsDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  const html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8">
<title>4DMIXX AI 전략 회의 — 결과 아카이브</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#0a0a14;color:#e8e8e6;max-width:700px;margin:0 auto;padding:2rem}
  h1{font-size:20px;color:#e94560;border-bottom:2px solid #e94560;padding-bottom:10px;margin-bottom:6px}
  .sub{font-size:12px;color:#555;margin-bottom:2rem}
  .latest{background:#0a1628;border:2px solid #00ff88;border-radius:10px;padding:14px 18px;margin-bottom:2rem;display:flex;align-items:center;justify-content:space-between}
  .latest-label{font-size:11px;color:#00ff88;margin-bottom:4px}
  .latest-date{font-size:15px;font-weight:700;color:#fff}
  .btn{padding:8px 16px;background:#00ff88;color:#000;border-radius:6px;text-decoration:none;font-size:13px;font-weight:700}
  .list{display:flex;flex-direction:column;gap:8px}
  .item{background:#111;border:1px solid #1a1a2e;border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between}
  .item-date{font-size:13px;color:#aaa}
  .item-link{font-size:12px;color:#5a9ae6;text-decoration:none}
  .item-link:hover{color:#fff}
  footer{text-align:center;font-size:11px;color:#333;margin-top:3rem}
</style>
</head><body>
<h1>4DMIXX AI 전략 회의 아카이브</h1>
<div class="sub">매일 오전 9시 자동 생성 · Powered by Claude API</div>
<div class="latest">
  <div>
    <div class="latest-label">최신 회의</div>
    <div class="latest-date">${dateTimeStr}</div>
  </div>
  <a href="latest.html" class="btn">바로 보기</a>
</div>
<div class="list">
  ${dirs.map(d => `<div class="item">
    <span class="item-date">📅 ${d}</span>
    <div style="display:flex;gap:10px">
      <a href="${d}/report.html" class="item-link">HTML 보고서</a>
      <a href="${d}/report.txt"  class="item-link">TXT</a>
    </div>
  </div>`).join('')}
</div>
<footer>© 4DMIXX AI 전략 회의실</footer>
</body></html>`;

  fs.writeFileSync(indexPath, html, 'utf-8');
}

main().catch(e => { console.error('💥 오류:', e); process.exit(1); });
