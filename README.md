# OpenAI Email Bot

Gmail에서 OpenAI 인증 메일을 자동으로 감지하고, 인증 코드를 추출하여 Discord 웹훅으로 전송하는 Node.js 봇.

## 주요 기능

- Gmail API를 통해 10초 간격으로 읽지 않은 OpenAI 관련 메일 폴링
- 메일 본문에서 인증 코드 자동 추출 (6자리/4자리 숫자, 알파벳+숫자 패턴)
- 추출된 인증 코드를 Discord 웹훅으로 임베드 메시지 전송
- 처리 완료된 메일 자동 읽음 처리
- 메일 조회 실패 시 Discord 알림 (첫 실패 1회 + 복구 시 1회)

## 기술 스택

| 구분 | 내용 |
|------|------|
| 런타임 | Node.js 18 |
| 프레임워크 | Express |
| API | Gmail API (googleapis) + OAuth2 |
| 알림 | Discord Webhook |
| 배포 | Docker + docker-compose |

## 빠른 시작

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env` 파일을 생성하고 아래 값을 입력:

```env
GMAIL_CLIENT_ID=your_client_id
GMAIL_CLIENT_SECRET=your_client_secret
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
PORT=3000
```

### 3. 서버 실행

```bash
npm start
# 또는 개발 모드
npm run dev
```

### 4. OAuth2 인증

1. 서버 시작 시 터미널에 출력되는 Google OAuth URL을 브라우저에서 열기
2. Google 계정 로그인 후 권한 허용
3. 인증 코드 복사
4. `http://localhost:3000/auth` 접속 후 인증 코드 입력

인증 완료 후 자동으로 10초 간격 메일 폴링이 시작됩니다.

## API 엔드포인트

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/` | GET | 서버 상태 확인 (JSON) |
| `/auth` | GET | OAuth2 인증 페이지 |
| `/auth` | POST | 인증 코드 처리 |
| `/check-openai` | POST | OpenAI 메일 수동 확인 |

## Discord 알림

### 인증 코드 알림

OpenAI 인증 메일에서 코드를 추출하면 주황색 임베드로 전송:

- 인증 코드
- 발신자 이메일
- 수신 시각

### 장애 알림

메일 조회가 실패하면 빨간색 임베드로 에러 알림 1회 전송.
이후 복구되면 초록색 임베드로 복구 알림 (다운타임 포함) 1회 전송.
연속 실패 시 알림이 반복되지 않습니다.

## Docker 배포

```bash
docker-compose up -d
```

자세한 배포 방법은 [DEPLOYMENT.md](DEPLOYMENT.md) 참고.

## 프로젝트 구조

```
mail_verify/
├── server.js              # 메인 애플리케이션 (단일 파일)
├── package.json
├── .env                   # 환경 변수 (Git 제외 권장)
├── Dockerfile             # Docker 빌드 설정
├── docker-compose.yml     # 컨테이너 오케스트레이션
├── docker-compose.prod.yml
├── deploy.sh              # 배포 스크립트
└── DEPLOYMENT.md          # Docker 배포 가이드
```

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `GMAIL_CLIENT_ID` | O | Google OAuth2 Client ID |
| `GMAIL_CLIENT_SECRET` | O | Google OAuth2 Client Secret |
| `DISCORD_WEBHOOK_URL` | O | Discord 웹훅 URL |
| `PORT` | X | 서버 포트 (기본: 3000) |
