// scripts/poll-meetings.mjs
// 스케줄 기반 Flow 포스트 폴링 → 미처리 글 발견 시 AI 회의 자동 실행
// 평일 09/12/15/18시, 토요일 09시(금요일 미처리 글 체크)
// 포스트에 #심층 포함 시 → deep 모드(6라운드), 기본 → quick 모드(1라운드)

import fetch from 'node-fetch';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FLOW_TOKEN    = process.env.FLOW_MCP_TOKEN || process.env.FLOW_API_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const PROJECT_IDS   = (process.env.FLOW_PROJECT_ID || '2916231').split(',').map(s => s.trim());
const FLOW_BASE     = 'https://api.flow.team';
const STATE_FILE    = join(__dirname, '.processed_posts.json');
// 48시간 lookback: 토요일에도 금요일 글을 확실히 포함
const LOOKBACK_MS   = 48 * 3600000;

if (!FLOW_TOKEN)    { console.error('❌ FLOW_MCP_TOKEN 없음'); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }

// ─── 상태 관리 ─────────────────────────────────────────────────────────────────
function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return new Set(data.processed || []);
  } catch { return new Set(); }
}

function saveState(processed) {
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ processed: [...processed] }, null, 2),
    'utf8'
  );
}

// ─── Flow API ─────────────────────────────────────────────────────────────────
const flowHeaders = {
  'x-flow-api-key': FLOW_TOKEN,
  'Content-Type':   'application/json',
  Accept:           'application/json',
};

async function getProjectPosts(projectId) {
  const res  = await fetch(
    `${FLOW_BASE}/user/posts/projects/${projectId}?pageSize=50`,
    { headers: flowHeaders }
  );
  const body = await res.json();
  const data = body?.response?.data || body?.data || {};
  const raw  = data.posts;
  return Array.isArray(raw) ? raw : (raw?.posts || []);
}

async function getPostDetail(postId) {
  const res  = await fetch(`${FLOW_BASE}/user/posts/${postId}`, { headers: flowHeaders });
  const body = await res.json();
  const data = body?.response?.data || body?.data || {};
  return data.post || data.postInfo || data;
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getPostCreatedAt(post) {
  const raw = post.registeredAt || post.RGST_DT || post.createdAt || post.RGSN_DTTM || '';
  if (!raw) return null;
  const s = String(raw).replace(/[-:\sT]/g, '').slice(0, 14).padEnd(14, '0');
  const d = new Date(
    `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:00+09:00`
  );
  return isNaN(d.getTime()) ? null : d.getTime();
}

function isSystemPost(post) {
  const title = (post.title || post.postTitle || post.TITLE || '').toLowerCase();
  return title.startsWith('[ai 회의]') || title.startsWith('[심층 회의]');
}

function getPostContent(detail) {
  return (
    detail.content || detail.contents || detail.body ||
    detail.postContent || detail.CONTENTS || detail.text || ''
  ).trim();
}

function getPostTitle(post) {
  return post.title || post.postTitle || post.TITLE || post.POST_TITLE || '회의 요청';
}

// 포스트에 #심층 포함 시 deep 모드, 기본 quick
function detectMode(content) {
  return /[#＃]심층/.test(content) ? 'deep' : 'quick';
}

// ─── 회의 실행 (flow-meeting.mjs 에 위임) ────────────────────────────────────
function runMeeting(postTitle, postContent, mode) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(__dirname, 'flow-meeting.mjs')], {
      env: {
        ...process.env,
        FLOW_POST_TITLE:   postTitle,
        FLOW_POST_CONTENT: postContent,
        MEETING_MODE:      mode,
      },
      stdio: 'inherit',
    });
    child.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`flow-meeting.mjs exit ${code}`))
    );
  });
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  const nowKST = new Date(Date.now() + 9 * 3600000);
  const nowStr = nowKST.toISOString().slice(0, 16).replace('T', ' ');
  const cutoff = Date.now() - LOOKBACK_MS;

  console.log(`\n[Flow 폴링 시작] ${nowStr} KST`);
  console.log(`  감시 프로젝트: ${PROJECT_IDS.join(', ')} | lookback: 48h`);

  const processed = loadState();
  const toProcess = [];

  for (const projectId of PROJECT_IDS) {
    let posts;
    try {
      posts = await getProjectPosts(projectId);
      console.log(`  프로젝트 ${projectId}: ${posts.length}개 포스트 조회`);
    } catch (e) {
      console.warn(`  프로젝트 ${projectId} 조회 실패: ${e.message}`);
      continue;
    }

    for (const post of posts) {
      const postId = String(post.postId || post.POST_ID || '');
      if (!postId) continue;

      // 이미 처리됨
      if (processed.has(postId)) continue;

      // 시스템(봇) 포스트 skip
      if (isSystemPost(post)) { processed.add(postId); continue; }

      // 시간 윈도우 밖
      const createdAt = getPostCreatedAt(post);
      if (createdAt !== null && createdAt < cutoff) {
        processed.add(postId);
        continue;
      }

      // 상세 내용 조회
      await sleep(300);
      let content = '';
      try {
        const detail = await getPostDetail(postId);
        content = getPostContent(detail);
      } catch (e) {
        console.warn(`  포스트 ${postId} 상세 조회 실패: ${e.message}`);
        continue;
      }

      if (!content || content.length < 5) {
        processed.add(postId);
        continue;
      }

      toProcess.push({
        postId,
        title:   getPostTitle(post),
        content,
        mode:    detectMode(content),
      });
    }

    await sleep(500);
  }

  if (toProcess.length === 0) {
    console.log('\n  새 회의 요청 없음 — 종료');
    saveState(processed);
    return;
  }

  console.log(`\n  신규 포스트 ${toProcess.length}개 발견`);

  for (const post of toProcess) {
    console.log(`\n  ▶ [${post.mode}] "${post.title}" (${post.postId})`);
    try {
      await runMeeting(post.title, post.content, post.mode);
      processed.add(post.postId);
      console.log(`  ✅ 완료: ${post.postId}`);
    } catch (e) {
      console.error(`  ❌ 오류: ${post.postId} — ${e.message}`);
    }
    await sleep(1000);
  }

  saveState(processed);
  console.log('\n[폴링 완료] 상태 저장');
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
