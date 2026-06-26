# 4DMIXX AI 전략 회의실 🏢

픽셀아트 2D 사무실에서 AI 직원 12명이 실시간으로 돌아다니며 전략 회의를 진행하는 인터랙티브 앱입니다.

## 🎮 데모

**GitHub Pages 배포 후** → `https://{your-username}.github.io/4dmixx-office/`

---

## 🚀 GitHub Pages 배포 방법 (5분)

### 1단계 — 저장소 만들기

1. [github.com](https://github.com) 로그인
2. 우측 상단 `+` → **New repository**
3. Repository name: `4dmixx-office`
4. **Public** 선택 (Pages 무료 사용)
5. **Create repository** 클릭

### 2단계 — 파일 업로드

```
index.html
office.js
agents.js
meeting.js
README.md
```

**방법 A: 웹 업로드 (쉬움)**
- 저장소 페이지에서 **Add file → Upload files**
- 4개 파일 모두 드래그 앤 드롭
- **Commit changes** 클릭

**방법 B: Git (개발자용)**
```bash
git clone https://github.com/{username}/4dmixx-office
cd 4dmixx-office
# 파일 복사 후
git add .
git commit -m "4DMIXX AI Office 초기 배포"
git push
```

### 3단계 — GitHub Pages 활성화

1. 저장소 → **Settings** 탭
2. 왼쪽 메뉴 **Pages** 클릭
3. Source: **Deploy from a branch**
4. Branch: **main** / `/ (root)` 선택
5. **Save** 클릭
6. 1~2분 후 `https://{username}.github.io/4dmixx-office/` 접속 가능

---

## 🔑 API 키 발급

1. [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) 접속
2. **Create Key** 클릭
3. `sk-ant-api03-...` 형태의 키 복사
4. 앱 상단 입력란에 붙여넣기 → **SAVE**

> ⚠️ API 키는 절대 코드에 직접 넣지 마세요. 입력란에 런타임으로 넣는 방식이 안전합니다.

---

## 🏢 팀 구성 (12명)

| 팀 | 팀장 | 사원1 | 사원2 |
|---|---|---|---|
| 기획팀 | 김기획 | 정분석 | 한기획 |
| 영업팀 | 박영업 | 오수주 | 강관계 |
| 마케팅팀 | 이마케 | 윤퍼포 | 신SEO |
| 콘텐츠팀 | 최콘텐 | 류영상 | 문SNS |

## 📋 6대 전략 주제

1. 원스톱 풀서비스 차별화
2. 로컬 B2B 파트너십
3. SNS 바이럴 전략
4. 산업군 버티컬 확장
5. 온라인 견적 고도화
6. AI설계 프리미엄화

---

## 🛠 기술 스택

- Vanilla HTML/CSS/JS (의존성 없음)
- Canvas 2D API (픽셀아트 렌더링)
- Anthropic Claude API (`claude-sonnet-4-6`)
- Google Fonts: Press Start 2P
