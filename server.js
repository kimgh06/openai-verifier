const express = require("express");
const { google } = require("googleapis");
const readline = require("readline");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Gmail API OAuth2 설정
let oauth2Client = null;
let gmail = null;

// 터미널 입력을 위한 readline 인터페이스
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

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

// OAuth2 클라이언트 초기화 함수
function initializeOAuth2() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    logWithTime(
      "GMAIL_CLIENT_ID와 GMAIL_CLIENT_SECRET이 설정되지 않았습니다.",
      "error"
    );
    return false;
  }

  if (!refreshToken) {
    logWithTime("GMAIL_REFRESH_TOKEN이 설정되지 않았습니다.", "error");
    return false;
  }

  try {
    oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      "https://developers.google.com/oauthplayground"
    );

    oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    gmail = google.gmail({ version: "v1", auth: oauth2Client });
    logWithTime("OAuth2 클라이언트가 초기화되었습니다.", "success");
    return true;
  } catch (error) {
    logWithTime(`OAuth2 클라이언트 초기화 실패: ${error.message}`, "error");
    return false;
  }
}

// 터미널에서 OAuth2 설정 진행
async function setupOAuth2Terminal() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    logWithTime("OAuth2 설정이 필요합니다:", "warning");
    logWithTime(
      "1. .env 파일에 GMAIL_CLIENT_ID와 GMAIL_CLIENT_SECRET을 추가하세요",
      "info"
    );
    logWithTime(
      "2. 서버를 재시작하면 자동으로 OAuth2 설정을 진행합니다",
      "info"
    );
    return false;
  }

  try {
    logWithTime("Gmail API OAuth2 설정을 시작합니다...", "debug");

    oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      "https://developers.google.com/oauthplayground"
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/gmail.modify"],
      prompt: "consent",
    });

    logWithTime("다음 단계를 따라 Gmail API를 설정하세요:", "info");
    logWithTime("1. 아래 URL을 브라우저에서 열기:", "info");
    console.log(authUrl);
    logWithTime("2. Google 계정으로 로그인하고 권한 허용", "info");
    logWithTime("3. 인증 코드를 복사", "info");
    logWithTime("4. 아래에 인증 코드 입력", "info");

    // 인증 코드 입력 받기
    const authCode = await question("인증 코드를 입력하세요: ");

    // 액세스 토큰과 리프레시 토큰 교환
    const { tokens } = await oauth2Client.getToken(authCode);

    logWithTime("인증이 완료되었습니다!", "success");
    logWithTime(`리프레시 토큰: ${tokens.refresh_token}`, "info");
    logWithTime(".env 파일에 다음을 추가하세요:", "info");
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GMAIL_USER_EMAIL=your_email@gmail.com`);

    // 테스트 연결
    logWithTime("Gmail API 연결을 테스트합니다...", "debug");

    oauth2Client.setCredentials({
      refresh_token: tokens.refresh_token,
    });

    gmail = google.gmail({ version: "v1", auth: oauth2Client });

    try {
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
  } catch (error) {
    logWithTime(`OAuth2 설정 실패: ${error.message}`, "error");
    return false;
  }
}

// 터미널 질문 함수
function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

// OpenAI 이메일 인증 코드 추출 함수
function extractOpenAIVerificationCode(subject, body) {
  // null/undefined 체크 추가
  if (!subject || !body) {
    return null;
  }

  // OpenAI 관련 키워드 확인
  const isOpenAIEmail =
    subject.toLowerCase().includes("openai") ||
    subject.toLowerCase().includes("verification") ||
    subject.toLowerCase().includes("verify") ||
    subject.toLowerCase().includes("confirm") ||
    body.toLowerCase().includes("openai") ||
    body.toLowerCase().includes("verification") ||
    body.toLowerCase().includes("verify") ||
    body.toLowerCase().includes("confirm");

  if (!isOpenAIEmail) return null;

  // 인증 코드 패턴 찾기 (6자리 숫자)
  const codePattern = /\b\d{6}\b/g;
  const codes = body.match(codePattern);

  // 4자리 숫자도 확인
  const codePattern4 = /\b\d{4}\b/g;
  const codes4 = body.match(codePattern4);

  // 알파벳+숫자 조합 (예: ABC123)
  const alphanumericPattern = /\b[A-Z]{2,4}\d{3,6}\b/g;
  const alphanumericCodes = body.match(alphanumericPattern);

  // 가장 긴 코드를 우선 선택 (더 구체적일 가능성)
  let bestCode = null;

  if (codes && codes.length > 0) {
    bestCode = codes[0];
  }

  if (codes4 && codes4.length > 0) {
    bestCode = codes4[0];
  }

  if (alphanumericCodes && alphanumericCodes.length > 0) {
    bestCode = alphanumericCodes[0];
  }

  return {
    code: bestCode,
    type: bestCode ? "verification_code" : "openai_email_no_code",
  };
}

// 메일 읽기 함수 (읽지 않은 OpenAI 이메일만 필터링)
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

    // 읽지 않은 OpenAI 관련 이메일만 검색
    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults: 20,
      q: "is:unread AND (from:openai OR from:noreply@openai.com OR subject:verification OR subject:verify OR subject:confirm)",
    });

    const messages = response.data.messages;

    if (!messages || messages.length === 0) {
      logWithTime("읽지 않은 OpenAI 관련 이메일이 없습니다.", "info");
      return;
    }

    logWithTime(
      `${messages.length}개의 읽지 않은 OpenAI 관련 이메일을 발견했습니다.`,
      "mail"
    );

    // 각 메일을 확인하고 인증 코드 추출
    for (const message of messages) {
      await processOpenAIEmail(message.id);
    }
  } catch (error) {
    logWithTime(`OpenAI 이메일 읽기 오류: ${error.message}`, "error");
  }
}

// Discord 웹훅으로 OpenAI 이메일 전송 (코드 번호만)
async function sendOpenAIEmailToDiscord(
  subject,
  from,
  date,
  body,
  verificationInfo
) {
  try {
    // 인증 코드가 있을 때만 Discord로 전송
    if (!verificationInfo.code) {
      logWithTime(
        "   인증 코드가 없어 Discord로 전송하지 않습니다.",
        "warning"
      );
      return;
    }

    // Discord 임베드 색상 설정
    const color = 0xff6b35; // 주황색 (인증 코드 있음)

    const webhookData = {
      embeds: [
        {
          title: "🔑 OpenAI 인증 코드",
          color: color,
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
          footer: {
            text: "OpenAI Email Bot",
          },
        },
      ],
    };

    const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(webhookData),
    });

    if (response.ok) {
      logWithTime(
        `   인증 코드 "${verificationInfo.code}"을 Discord로 전송했습니다.`,
        "success"
      );
    } else {
      logWithTime(`   Discord 웹훅 전송 실패: ${response.statusText}`, "error");
    }
  } catch (error) {
    logWithTime(`   Discord 전송 오류: ${error.message}`, "error");
  }
}

// OpenAI 이메일 처리 함수
async function processOpenAIEmail(messageId) {
  try {
    // 메일 상세 정보 가져오기
    const message = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
    });

    const headers = message.data.payload.headers;
    const subject =
      headers.find((h) => h.name === "Subject")?.value || "제목 없음";
    const from = headers.find((h) => h.name === "From")?.value || "발신자 없음";
    const date = headers.find((h) => h.name === "Date")?.value || "날짜 없음";

    // 메일 본문 추출
    let body = "";
    if (message.data.payload.body) {
      body = message.data.payload.body.data;
    } else if (message.data.payload.parts) {
      const textPart = message.data.payload.parts.find(
        (part) => part.mimeType === "text/plain"
      );
      if (textPart && textPart.body) {
        body = textPart.body.data;
      }
    }

    // Base64 디코딩
    if (body) {
      body = Buffer.from(body, "base64").toString("utf-8");
    }

    // OpenAI 인증 코드 추출
    const verificationInfo = extractOpenAIVerificationCode(subject, body);

    if (verificationInfo) {
      logWithTime(`새로운 OpenAI 이메일 발견: ${subject}`, "mail");
      logWithTime(`   발신자: ${from}`, "info");
      logWithTime(
        `   인증 코드: ${verificationInfo.code || "코드 없음"}`,
        "info"
      );

      // 인증 코드가 있을 때만 Discord로 전송
      if (verificationInfo.code) {
        await sendOpenAIEmailToDiscord(
          subject,
          from,
          date,
          body,
          verificationInfo
        );
      }

      // 메일을 읽음으로 표시 (Gmail에서 읽음 처리)
      try {
        await gmail.users.messages.modify({
          userId: "me",
          id: messageId,
          requestBody: {
            removeLabelIds: ["UNREAD"],
          },
        });
        logWithTime(`   Gmail에서 읽음으로 표시했습니다.`, "success");
      } catch (modifyError) {
        logWithTime(`   Gmail 읽음 처리 실패: ${modifyError.message}`, "error");
      }
    }
  } catch (error) {
    logWithTime(`OpenAI 이메일 처리 오류: ${error.message}`, "error");
  }
}

// Express 서버 설정
app.use(express.json());

// 상태 확인 엔드포인트
app.get("/", (req, res) => {
  const isConfigured = gmail !== null;

  res.json({
    status: isConfigured ? "running" : "setup_required",
    message: isConfigured
      ? "OpenAI 이메일 인증 코드 봇이 실행 중입니다."
      : "OAuth2 설정이 필요합니다. 터미널에서 설정을 진행하세요.",
    nextCheck: isConfigured ? "10초 후" : "설정 완료 후",
    features: [
      "OpenAI 이메일 자동 감지",
      "인증 코드 자동 추출",
      "Discord 웹훅 전송",
      "10초마다 자동 확인",
    ],
    configuration: {
      oauth2: isConfigured ? "configured" : "not_configured",
      discord_webhook: process.env.DISCORD_WEBHOOK_URL
        ? "configured"
        : "not_configured",
    },
  });
});

// OpenAI 이메일 수동 확인 엔드포인트
app.post("/check-openai", async (req, res) => {
  if (!gmail) {
    return res
      .status(400)
      .json({
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

// 이메일 검색 엔드포인트
app.post("/search-emails", async (req, res) => {
  if (!gmail) {
    return res
      .status(400)
      .json({
        error: "OAuth2 설정이 필요합니다. 터미널에서 설정을 진행하세요.",
      });
  }

  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "검색어가 필요합니다." });
    }

    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults: 10,
      q: query,
    });

    const messages = response.data.messages || [];
    res.json({
      message: `${messages.length}개의 이메일을 발견했습니다.`,
      count: messages.length,
      query: query,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 서버 시작
app.listen(PORT, async () => {
  logWithTime(`OpenAI 이메일 봇이 포트 ${PORT}에서 실행 중입니다.`, "bot");

  // OAuth2 초기화 시도
  if (initializeOAuth2()) {
    logWithTime(`OpenAI 이메일을 10초마다 확인합니다.`, "bot");
    logWithTime(`인증 코드 자동 추출 및 Discord 전송`, "debug");
    logWithTime(
      `Discord 웹훅: ${
        process.env.DISCORD_WEBHOOK_URL ? "설정됨" : "설정되지 않음"
      }`,
      "info"
    );

    // 10초마다 OpenAI 이메일 확인 시작
    setInterval(readOpenAIEmails, 10000);
  } else {
    logWithTime(`OAuth2 설정이 필요합니다.`, "warning");
    logWithTime(`터미널에서 OAuth2 설정을 진행합니다...`, "info");

    // 터미널에서 OAuth2 설정 진행
    const setupSuccess = await setupOAuth2Terminal();

    if (setupSuccess) {
      logWithTime(`OAuth2 설정이 완료되었습니다!`, "success");
      logWithTime(`이제 OpenAI 이메일을 10초마다 확인합니다.`, "bot");

      // 10초마다 OpenAI 이메일 확인 시작
      setInterval(readOpenAIEmails, 10000);
    } else {
      logWithTime(`OAuth2 설정에 실패했습니다.`, "error");
      logWithTime(`.env 파일을 확인하고 서버를 재시작하세요.`, "warning");
    }

    // readline 인터페이스 닫기
    rl.close();
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
