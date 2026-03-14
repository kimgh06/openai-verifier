const express = require("express");
const { google } = require("googleapis");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Gmail API OAuth2 설정
let oauth2Client = null;
let gmail = null;

// 메일 조회 실패 상태 추적
let failureState = {
  isDown: false,
  lastError: null,
  failedAt: null,
  notifiedAt: null,
};

// 폴링 타이머 참조 (재시작용)
let pollTimer = null;

// 폴링 간격 설정 (ms)
const POLL_INTERVAL_DEFAULT = 60000; // 기본 60초
const POLL_INTERVAL_BACKOFF = 300000; // rate limit 시 5분
let currentPollInterval = POLL_INTERVAL_DEFAULT;

// 시간이 포함된 로그 함수
function logWithTime(message, type = "info") {
  const timestamp = new Date().toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const emoji = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌",
    debug: "🔍",
    mail: "📧",
    bot: "🤖",
  };

  console.log(`[${timestamp}] ${emoji[type] || emoji.info} ${message}`);
}

// 환경 변수 검증 함수
function validateEnvironmentVariables() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    logWithTime(
      "GMAIL_CLIENT_ID 또는 GMAIL_CLIENT_SECRET이 설정되지 않았습니다.",
      "error"
    );
    return false;
  }

  return { clientId, clientSecret };
}

// OAuth2 클라이언트 생성 함수
function createOAuth2Client(clientId, clientSecret) {
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    "https://developers.google.com/oauthplayground"
  );
}

// 인증 URL 생성 함수
function generateAuthUrl(oauth2Client) {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.modify"],
    prompt: "consent",
  });
}

// 인증 안내 메시지 출력 함수
function displayAuthInstructions(authUrl) {
  logWithTime("다음 단계를 따라 Gmail API를 설정하세요:", "info");
  logWithTime("1. 아래 URL을 브라우저에서 열기:", "info");
  console.log(authUrl);
  logWithTime("2. Google 계정으로 로그인하고 권한 허용", "info");
  logWithTime("3. 인증 코드를 복사", "info");
  logWithTime("4. 브라우저에서 http://localhost:3000/auth 입력", "info");
  logWithTime("5. 인증 코드를 브라우저에 입력", "info");
  logWithTime("또는 URL에 ?code=인증코드 형식으로 직접 접속 가능", "info");
  logWithTime("예: http://localhost:3000/auth?code=4/0AfJohXn...", "info");
  logWithTime("브라우저에서 인증 코드를 입력해주세요...", "info");
  logWithTime("http://localhost:3000/auth 페이지를 열어주세요", "info");
}

// OAuth2 설정 진행
async function setupOAuth2() {
  const envVars = validateEnvironmentVariables();
  if (!envVars) return false;

  try {
    logWithTime("Gmail API OAuth2 설정을 시작합니다...", "debug");

    oauth2Client = createOAuth2Client(envVars.clientId, envVars.clientSecret);
    const authUrl = generateAuthUrl(oauth2Client);
    displayAuthInstructions(authUrl);

    return await waitForBrowserAuth();
  } catch (error) {
    logWithTime(`OAuth2 설정 실패: ${error.message}`, "error");
    return false;
  }
}

// 브라우저 인증 대기 함수
async function waitForBrowserAuth() {
  return new Promise((resolve) => {
    global.authCompleted = false;
    global.authTokens = null;

    const checkInterval = setInterval(() => {
      if (global.authCompleted) {
        clearInterval(checkInterval);
        handleAuthCompletion(resolve);
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(checkInterval);
      if (!global.authCompleted) {
        logWithTime("인증 시간이 초과되었습니다. 다시 시도해주세요.", "error");
        resolve(false);
      }
    }, 300000);
  });
}

// 인증 완료 처리 함수
function handleAuthCompletion(resolve) {
  if (global.authTokens) {
    logWithTime("브라우저를 통한 인증이 완료되었습니다!", "success");
    testGmailConnection(global.authTokens.refresh_token).then((success) =>
      resolve(success)
    );
  } else {
    logWithTime("브라우저 인증에 실패했습니다.", "error");
    resolve(false);
  }
}

// Gmail 연결 테스트
async function testGmailConnection(refreshToken) {
  try {
    logWithTime("Gmail API 연결을 테스트합니다...", "debug");

    oauth2Client.setCredentials({ refresh_token: refreshToken });
    gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const profile = await gmail.users.getProfile({ userId: "me" });
    logWithTime("Gmail API 연결 성공!", "success");
    logWithTime(`이메일 주소: ${profile.data.emailAddress}`, "info");
    logWithTime("설정이 완료되었습니다!", "success");
    logWithTime("이제 서버가 자동으로 메일을 확인하기 시작합니다.", "info");
    return true;
  } catch (error) {
    logWithTime(`Gmail API 연결 실패: ${error.message}`, "error");
    return false;
  }
}

// OpenAI 이메일 필터링 함수
function isOpenAIEmail(subject, body) {
  const keywords = ["openai", "verification", "verify", "confirm"];

  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase();

  return keywords.some(
    (keyword) => subjectLower.includes(keyword) || bodyLower.includes(keyword)
  );
}

// 인증 코드 패턴 매칭 함수
function extractVerificationCodes(body) {
  const patterns = [
    { regex: /\b\d{6}\b/g, name: "6자리 숫자" },
    { regex: /\b\d{4}\b/g, name: "4자리 숫자" },
    { regex: /\b[A-Z]{2,4}\d{3,6}\b/g, name: "알파벳+숫자" },
  ];

  for (const pattern of patterns) {
    const matches = body.match(pattern.regex);
    if (matches && matches.length > 0) return matches[0];
  }

  return null;
}

// OpenAI 이메일 인증 코드 추출 함수
function extractOpenAIVerificationCode(subject, body) {
  if (!subject || !body) return null;

  if (!isOpenAIEmail(subject, body)) return null;

  const code = extractVerificationCodes(body);

  return {
    code,
    type: code ? "verification_code" : "openai_email_no_code",
  };
}

// Gmail 메시지 검색 함수
async function searchUnreadOpenAIEmails() {
  return await gmail.users.messages.list({
    userId: "me",
    maxResults: 20,
    q: "is:unread AND (from:openai OR from:noreply@openai.com OR subject:verification OR subject:verify OR subject:confirm)",
  });
}

// 메일 읽기 함수
async function readOpenAIEmails() {
  if (!gmail) {
    logWithTime(
      "Gmail API가 초기화되지 않았습니다. OAuth2 설정을 먼저 완료하세요.",
      "error"
    );
    return;
  }

  try {
    logWithTime("읽지 않은 OpenAI 이메일 확인 중...", "debug");

    const response = await searchUnreadOpenAIEmails();
    const messages = response.data.messages;

    // 조회 성공 → 이전에 장애 상태였으면 복구 알림
    if (failureState.isDown) {
      logWithTime("메일 조회가 복구되었습니다.", "success");
      await sendRecoveryToDiscord();
      failureState = { isDown: false, lastError: null, failedAt: null, notifiedAt: null };
      currentPollInterval = POLL_INTERVAL_DEFAULT;
      logWithTime(`폴링 간격을 ${POLL_INTERVAL_DEFAULT / 1000}초로 복원합니다.`, "info");
    }

    if (!messages || messages.length === 0) {
      logWithTime("읽지 않은 OpenAI 관련 이메일이 없습니다.", "info");
      return;
    }

    logWithTime(
      `${messages.length}개의 읽지 않은 OpenAI 관련 이메일을 발견했습니다.`,
      "mail"
    );

    for (const message of messages) {
      await processOpenAIEmail(message.id);
    }
  } catch (error) {
    logWithTime(`OpenAI 이메일 읽기 오류: ${error.message}`, "error");

    // invalid_grant 감지 시 재인증 모드 진입
    if (error.message && error.message.includes("invalid_grant")) {
      logWithTime("OAuth2 토큰이 만료되었습니다. 재인증 모드로 전환합니다.", "error");
      gmail = null;
      oauth2Client = null;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      await sendAuthRequiredToDiscord();
      return;
    }

    // Rate limit 감지 시 백오프
    if (error.message && error.message.includes("rate limit")) {
      currentPollInterval = POLL_INTERVAL_BACKOFF;
      logWithTime(`Rate limit 감지 - 폴링 간격을 ${POLL_INTERVAL_BACKOFF / 1000}초로 늘립니다.`, "warning");
    }

    // 첫 실패 시에만 Discord 알림 전송
    if (!failureState.isDown) {
      failureState.isDown = true;
      failureState.lastError = error.message;
      failureState.failedAt = new Date();
      failureState.notifiedAt = new Date();
      await sendErrorToDiscord(error.message);
    }
  }
}

// Discord 웹훅 데이터 생성 함수
function createDiscordWebhookData(from, date, verificationInfo) {
  return {
    embeds: [
      {
        title: "🔑 OpenAI 인증 코드",
        color: 0xff6b35,
        fields: [
          {
            name: "🔢 인증 코드",
            value: `**${verificationInfo.code}**`,
            inline: false,
          },
          {
            name: "📧 이메일",
            value: from,
            inline: true,
          },
          {
            name: "📅 시간",
            value: new Date(date).toLocaleString("ko-KR"),
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "OpenAI Email Bot" },
      },
    ],
  };
}

// Discord 웹훅 전송 함수
async function sendToDiscord(webhookData) {
  const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookData),
  });

  return response.ok;
}

// Discord 웹훅으로 전송
async function sendOpenAIEmailToDiscord(from, date, verificationInfo) {
  try {
    if (!verificationInfo.code) {
      logWithTime(
        "   인증 코드가 없어 Discord로 전송하지 않습니다.",
        "warning"
      );
      return;
    }

    const webhookData = createDiscordWebhookData(from, date, verificationInfo);
    const success = await sendToDiscord(webhookData);

    if (success) {
      logWithTime(
        `   인증 코드 "${verificationInfo.code}"을 Discord로 전송했습니다.`,
        "success"
      );
    } else {
      logWithTime(`   Discord 웹훅 전송 실패`, "error");
    }
  } catch (error) {
    logWithTime(`   Discord 전송 오류: ${error.message}`, "error");
  }
}

// Discord 에러 알림 전송 함수
async function sendErrorToDiscord(errorMessage) {
  try {
    const webhookData = {
      embeds: [
        {
          title: "메일 조회 실패",
          color: 0xff0000,
          fields: [
            {
              name: "에러 내용",
              value: errorMessage,
              inline: false,
            },
            {
              name: "발생 시각",
              value: new Date().toLocaleString("ko-KR"),
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "OpenAI Email Bot - Error Alert" },
        },
      ],
    };

    const success = await sendToDiscord(webhookData);
    if (success) {
      logWithTime("에러 알림을 Discord로 전송했습니다.", "warning");
    } else {
      logWithTime("에러 알림 Discord 전송 실패", "error");
    }
  } catch (error) {
    logWithTime(`에러 알림 전송 중 오류: ${error.message}`, "error");
  }
}

// Discord 복구 알림 전송 함수
async function sendRecoveryToDiscord() {
  try {
    const downtime = failureState.failedAt
      ? Math.round((Date.now() - failureState.failedAt.getTime()) / 1000)
      : 0;
    const minutes = Math.floor(downtime / 60);
    const seconds = downtime % 60;
    const durationText =
      minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;

    const webhookData = {
      embeds: [
        {
          title: "메일 조회 복구",
          color: 0x28a745,
          fields: [
            {
              name: "장애 시작",
              value: failureState.failedAt
                ? failureState.failedAt.toLocaleString("ko-KR")
                : "알 수 없음",
              inline: true,
            },
            {
              name: "복구 시각",
              value: new Date().toLocaleString("ko-KR"),
              inline: true,
            },
            {
              name: "다운타임",
              value: durationText,
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "OpenAI Email Bot - Recovery" },
        },
      ],
    };

    const success = await sendToDiscord(webhookData);
    if (success) {
      logWithTime("복구 알림을 Discord로 전송했습니다.", "success");
    } else {
      logWithTime("복구 알림 Discord 전송 실패", "error");
    }
  } catch (error) {
    logWithTime(`복구 알림 전송 중 오류: ${error.message}`, "error");
  }
}

// Discord 봇 시작 알림 전송 함수
async function sendStartupToDiscord() {
  try {
    const webhookData = {
      embeds: [
        {
          title: "봇 시작됨",
          color: 0x007bff,
          fields: [
            {
              name: "상태",
              value: "OpenAI 이메일 봇이 가동되었습니다.",
              inline: false,
            },
            {
              name: "시작 시각",
              value: new Date().toLocaleString("ko-KR"),
              inline: true,
            },
            {
              name: "폴링 간격",
              value: "60초",
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "OpenAI Email Bot - Startup" },
        },
      ],
    };

    const success = await sendToDiscord(webhookData);
    if (success) {
      logWithTime("봇 시작 알림을 Discord로 전송했습니다.", "success");
    } else {
      logWithTime("봇 시작 알림 Discord 전송 실패", "error");
    }
  } catch (error) {
    logWithTime(`봇 시작 알림 전송 중 오류: ${error.message}`, "error");
  }
}

// Discord 인증 필요 알림 전송 함수
async function sendAuthRequiredToDiscord() {
  try {
    const webhookData = {
      embeds: [
        {
          title: "봇 시작됨 - 인증 필요",
          color: 0xffc107,
          fields: [
            {
              name: "상태",
              value: "서버가 시작되었지만 OAuth2 토큰 설정이 필요합니다.",
              inline: false,
            },
            {
              name: "설정 방법",
              value: `http://localhost:${PORT}/auth 에서 인증을 진행하세요.`,
              inline: false,
            },
            {
              name: "시작 시각",
              value: new Date().toLocaleString("ko-KR"),
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "OpenAI Email Bot - Auth Required" },
        },
      ],
    };

    const success = await sendToDiscord(webhookData);
    if (success) {
      logWithTime("인증 필요 알림을 Discord로 전송했습니다.", "warning");
    } else {
      logWithTime("인증 필요 알림 Discord 전송 실패", "error");
    }
  } catch (error) {
    logWithTime(`인증 필요 알림 전송 중 오류: ${error.message}`, "error");
  }
}

// 이메일 헤더 추출 함수
function extractEmailHeaders(headers) {
  return {
    subject: headers.find((h) => h.name === "Subject")?.value || "제목 없음",
    from: headers.find((h) => h.name === "From")?.value || "발신자 없음",
    date: headers.find((h) => h.name === "Date")?.value || "날짜 없음",
  };
}

// 이메일 본문 추출 함수
function extractEmailBody(payload) {
  let body = "";

  if (payload.body) {
    body = payload.body.data;
  } else if (payload.parts) {
    const textPart = payload.parts.find(
      (part) => part.mimeType === "text/plain"
    );
    if (textPart && textPart.body) body = textPart.body.data;
  }

  if (body) body = Buffer.from(body, "base64").toString("utf-8");

  return body;
}

// 이메일 읽음 처리 함수
async function markEmailAsRead(messageId) {
  try {
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
    logWithTime(`   Gmail에서 읽음으로 표시했습니다.`, "success");
  } catch (modifyError) {
    logWithTime(`   Gmail 읽음 처리 실패: ${modifyError.message}`, "error");
  }
}

// OpenAI 이메일 처리 함수
async function processOpenAIEmail(messageId) {
  try {
    const message = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
    });

    const headers = extractEmailHeaders(message.data.payload.headers);
    const body = extractEmailBody(message.data.payload);
    const verificationInfo = extractOpenAIVerificationCode(
      headers.subject,
      body
    );

    if (verificationInfo) {
      logWithTime(`새로운 OpenAI 이메일 발견: ${headers.subject}`, "mail");
      logWithTime(`   발신자: ${headers.from}`, "info");
      logWithTime(
        `   인증 코드: ${verificationInfo.code || "코드 없음"}`,
        "info"
      );

      if (verificationInfo.code) {
        await sendOpenAIEmailToDiscord(
          headers.from,
          headers.date,
          verificationInfo
        );
      }

      await markEmailAsRead(messageId);
    }
  } catch (error) {
    logWithTime(`OpenAI 이메일 처리 오류: ${error.message}`, "error");
  }
}

// 서버 상태 확인 함수
function getServerStatus() {
  const isConfigured = gmail !== null;

  return {
    status: isConfigured ? "running" : "setup_required",
    message: isConfigured
      ? "OpenAI 이메일 인증 코드 봇이 실행 중입니다."
      : "OAuth2 설정이 필요합니다. 터미널에서 설정을 진행하세요.",
    configuration: {
      oauth2: isConfigured ? "configured" : "not_configured",
      discord_webhook: process.env.DISCORD_WEBHOOK_URL
        ? "configured"
        : "not_configured",
    },
  };
}

// Express 서버 설정 (메모리 최적화)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// 상태 확인 엔드포인트
app.get("/", (req, res) => {
  res.json(getServerStatus());
});

// OAuth2 인증 페이지
app.get("/auth", (req, res) => {
  const isConfigured = gmail !== null;
  const codeFromQuery = req.query.code;

  if (isConfigured) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>OAuth2 설정 완료</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .success { color: #28a745; background: #d4edda; padding: 15px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1>✅ OAuth2 설정 완료</h1>
        <div class="success">
          <h2>Gmail API가 이미 설정되어 있습니다!</h2>
          <p>서버가 정상적으로 실행 중입니다.</p>
        </div>
      </body>
      </html>
    `);
  }

  // URL 쿼리에서 코드가 있으면 자동으로 처리
  if (codeFromQuery) {
    logWithTime(
      `URL 쿼리에서 인증 코드를 받았습니다: ${codeFromQuery}`,
      "info"
    );
    processAuthCode(codeFromQuery, res);
    return;
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Gmail OAuth2 인증</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f8f9fa; }
        .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .step { background: #e9ecef; padding: 15px; margin: 15px 0; border-radius: 5px; border-left: 4px solid #007bff; }
        .form-group { margin: 20px 0; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="text"] { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 16px; }
        button { background: #007bff; color: white; padding: 12px 24px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
        button:hover { background: #0056b3; }
        .success, .error { padding: 15px; border-radius: 5px; display: none; }
        .success { color: #28a745; background: #d4edda; }
        .error { color: #721c24; background: #f8d7da; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔐 Gmail OAuth2 인증</h1>
        
        <div class="step">
          <h3>📋 단계별 안내</h3>
          <ol>
            <li>터미널에서 제공된 URL을 브라우저에서 열기</li>
            <li>Google 계정으로 로그인하고 권한 허용</li>
            <li>인증 코드를 복사</li>
            <li>아래 입력창에 인증 코드 입력</li>
            <li>제출 버튼 클릭</li>
          </ol>
        </div>

        <form id="authForm">
          <div class="form-group">
            <label for="authCode">인증 코드:</label>
            <input type="text" id="authCode" name="authCode" placeholder="4/0AfJohXn..." required>
          </div>
          
          <button type="submit">인증 완료</button>
        </form>

        <div id="success" class="success">
          <h3>✅ 인증 성공!</h3>
          <p>Gmail API 인증이 완료되었습니다.</p>
          <p>터미널을 확인하여 다음 단계를 진행하세요.</p>
        </div>

        <div id="error" class="error">
          <h3>❌ 인증 실패</h3>
          <p id="errorMessage">인증 코드가 유효하지 않습니다.</p>
        </div>
      </div>

      <script>
        document.getElementById('authForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const authCode = document.getElementById('authCode').value.trim();
          
          if (!authCode) {
            showError('인증 코드를 입력해주세요.');
            return;
          }

          try {
            const response = await fetch('/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: authCode })
            });

            const result = await response.json();

            if (result.success) {
              showSuccess();
              document.getElementById('authForm').style.display = 'none';
            } else {
              showError(result.message || '인증에 실패했습니다.');
            }
          } catch (error) {
            showError('서버 연결 오류가 발생했습니다.');
          }
        });

        function showSuccess() {
          document.getElementById('success').style.display = 'block';
          document.getElementById('error').style.display = 'none';
        }

        function showError(message) {
          document.getElementById('errorMessage').textContent = message;
          document.getElementById('error').style.display = 'block';
          document.getElementById('success').style.display = 'none';
        }
      </script>
    </body>
    </html>
  `);
});

// 폴링 시작 함수
function startPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }
  currentPollInterval = POLL_INTERVAL_DEFAULT;
  const pollLoop = async () => {
    await readOpenAIEmails();
    pollTimer = setTimeout(pollLoop, currentPollInterval);
  };
  pollTimer = setTimeout(pollLoop, currentPollInterval);
  logWithTime(`OpenAI 이메일을 ${POLL_INTERVAL_DEFAULT / 1000}초마다 확인합니다.`, "bot");
}

// 인증 코드 처리 함수
async function processAuthCode(code, res) {
  try {
    if (!code) {
      return res.json({ success: false, message: "인증 코드가 필요합니다." });
    }

    const envVars = validateEnvironmentVariables();
    if (!envVars) {
      return res.json({
        success: false,
        message:
          "OAuth2 설정이 필요합니다. GMAIL_CLIENT_ID와 GMAIL_CLIENT_SECRET을 확인하세요.",
      });
    }

    const newOAuth2Client = createOAuth2Client(
      envVars.clientId,
      envVars.clientSecret
    );
    const { tokens } = await newOAuth2Client.getToken(code);

    // Gmail 클라이언트 재설정
    oauth2Client = newOAuth2Client;
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
    gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // 연결 테스트
    const profile = await gmail.users.getProfile({ userId: "me" });
    logWithTime(`Gmail 재인증 성공! 이메일: ${profile.data.emailAddress}`, "success");

    // 장애 상태 초기화
    failureState = { isDown: false, lastError: null, failedAt: null, notifiedAt: null };

    // 폴링 재시작
    startPolling();
    await sendStartupToDiscord();

    global.authTokens = tokens;
    global.authCompleted = true;

    const response = {
      success: true,
      message: "인증이 완료되었습니다! 메일 확인이 재개됩니다.",
    };

    if (res) {
      res.json(response);
    }

    return response;
  } catch (error) {
    global.authError = error.message;
    global.authCompleted = true;

    const response = { success: false, message: `인증 실패: ${error.message}` };

    if (res) {
      res.json(response);
    }

    return response;
  }
}

// OAuth2 인증 코드 처리 (POST)
app.post("/auth", async (req, res) => {
  const { code } = req.body;
  await processAuthCode(code, res);
});

// OpenAI 이메일 수동 확인 엔드포인트
app.post("/check-openai", async (req, res) => {
  if (!gmail) {
    return res.status(400).json({
      error: "OAuth2 설정이 필요합니다. 터미널에서 설정을 진행하세요.",
    });
  }

  try {
    await readOpenAIEmails();
    res.json({ message: "OpenAI 이메일 확인 완료" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 서버 시작
app.listen(PORT, async () => {
  logWithTime(`OpenAI 이메일 봇이 포트 ${PORT}에서 실행 중입니다.`, "bot");

  // 서버 시작 즉시 인증 필요 알림 전송
  await sendAuthRequiredToDiscord();

  const setupSuccess = await setupOAuth2();

  if (setupSuccess) {
    logWithTime(`OAuth2 설정이 완료되었습니다!`, "success");
    await sendStartupToDiscord();
    startPolling();
  }
});

// 에러 핸들링
process.on("unhandledRejection", (reason, promise) => {
  logWithTime(`Unhandled Rejection at: ${promise}, reason: ${reason}`, "error");
});

process.on("uncaughtException", (error) => {
  logWithTime(`Uncaught Exception: ${error}`, "error");
  process.exit(1);
});
