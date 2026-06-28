export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Flow 토큰 검증
    const body = await request.text();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const token =
      payload.token ||
      request.headers.get('x-flow-hook-token') ||
      request.headers.get('x-hook-token') ||
      '';

    if (env.FLOW_HOOK_TOKEN && token !== env.FLOW_HOOK_TOKEN) {
      // 디버그: 처음 실행 시 토큰 불일치 확인용
      console.log('received token:', token);
      console.log('payload keys:', Object.keys(payload).join(', '));
    }

    // Flow 웹훅 payload 파싱 (여러 형식 대응)
    const post   = payload.post   || payload.data   || payload;
    const title   = post.title    || post.subject    || '(제목 없음)';
    const content = post.content  || post.body       || post.text || body;
    const userId  = post.author?.email || post.writer?.email || payload.userId || '';

    // 프로젝트 필터 (env.FLOW_PROJECT_ID 가 설정된 경우만 체크)
    const projectId = payload.project?.id || payload.projectId || '';
    if (env.FLOW_PROJECT_ID && projectId && projectId !== env.FLOW_PROJECT_ID) {
      return new Response('Ignored: different project', { status: 200 });
    }

    // GitHub Actions repository_dispatch 호출
    const ghRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization:          `Bearer ${env.GITHUB_TOKEN}`,
          Accept:                 'application/vnd.github+json',
          'Content-Type':         'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          event_type: 'flow-new-post',
          client_payload: { title, content, userId },
        }),
      }
    );

    if (!ghRes.ok) {
      const err = await ghRes.text();
      console.error('GitHub dispatch error:', err);
      return new Response(`GitHub error: ${err}`, { status: 502 });
    }

    return new Response('OK', { status: 200 });
  },
};
