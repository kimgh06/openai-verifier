# 🐳 OpenAI Email Bot - Docker 배포 가이드

## 📋 목차

- [개요](#개요)
- [사전 요구사항](#사전-요구사항)
- [빠른 시작](#빠른-시작)
- [환경별 배포](#환경별-배포)
- [고급 설정](#고급-설정)
- [모니터링](#모니터링)
- [문제 해결](#문제-해결)

## 🎯 개요

이 가이드는 OpenAI Email Bot을 Docker를 사용하여 배포하는 방법을 설명합니다.

## ✅ 사전 요구사항

- Docker 20.10+
- Docker Compose 2.0+
- Git
- 4GB+ RAM
- 10GB+ 디스크 공간

## 🚀 빠른 시작

### 1. 저장소 클론

```bash
git clone <repository-url>
cd mail_verify
```

### 2. 환경 변수 설정

```bash
cp .env.example .env
# .env 파일 편집하여 실제 값 입력
```

### 3. 배포 스크립트 실행 권한 부여

```bash
chmod +x deploy.sh
```

### 4. 개발 환경 배포

```bash
./deploy.sh
```

## 🌍 환경별 배포

### 개발 환경

```bash
./deploy.sh development
# 또는
./deploy.sh dev
```

**특징:**

- 포트 3000 직접 노출
- 디버그 로그 활성화
- 개발용 설정

### 프로덕션 환경

```bash
./deploy.sh production
# 또는
./deploy.sh prod
```

**특징:**

- Nginx 리버스 프록시
- SSL/TLS 지원
- 리소스 제한
- Redis 캐시
- 보안 강화

## ⚙️ 고급 설정

### 환경 변수 파일 분리

#### 개발용 (.env)

```env
NODE_ENV=development
PORT=3000
GMAIL_CLIENT_ID=your_dev_client_id
GMAIL_CLIENT_SECRET=your_dev_client_secret
GMAIL_REFRESH_TOKEN=your_dev_refresh_token
DISCORD_WEBHOOK_URL=your_dev_webhook_url
```

#### 프로덕션용 (.env.production)

```env
NODE_ENV=production
PORT=3000
GMAIL_CLIENT_ID=your_prod_client_id
GMAIL_CLIENT_SECRET=your_prod_client_secret
GMAIL_REFRESH_TOKEN=your_prod_refresh_token
DISCORD_WEBHOOK_URL=your_prod_webhook_url
REDIS_PASSWORD=your_redis_password
```

### Nginx 설정 (프로덕션)

#### nginx/nginx.prod.conf

```nginx
events {
    worker_connections 1024;
}

http {
    upstream openai_bot {
        server openai-email-bot:3000;
    }

    server {
        listen 80;
        server_name your-domain.com;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name your-domain.com;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;

        location / {
            proxy_pass http://openai_bot;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }
}
```

## 📊 모니터링

### 서비스 상태 확인

```bash
./deploy.sh status
```

### 로그 확인

```bash
./deploy.sh logs
```

### 실시간 모니터링

```bash
docker-compose logs -f openai-email-bot
```

### 헬스체크

```bash
curl http://localhost:3000/
curl http://localhost/health  # Nginx 사용 시
```

## 🔧 문제 해결

### 일반적인 문제들

#### 1. 포트 충돌

```bash
# 포트 사용 확인
netstat -tulpn | grep :3000

# 기존 컨테이너 정리
./deploy.sh stop
docker system prune -f
```

#### 2. 권한 문제

```bash
# Docker 그룹 확인
groups $USER

# Docker 그룹 추가 (필요시)
sudo usermod -aG docker $USER
newgrp docker
```

#### 3. 메모리 부족

```bash
# 컨테이너 리소스 확인
docker stats

# 리소스 제한 조정 (docker-compose.prod.yml)
deploy:
  resources:
    limits:
      memory: 1G
      cpus: '1.0'
```

#### 4. 환경 변수 문제

```bash
# 환경 변수 확인
docker-compose exec openai-email-bot env | grep GMAIL

# .env 파일 재로드
./deploy.sh restart
```

### 로그 분석

#### 에러 로그 필터링

```bash
docker-compose logs openai-email-bot | grep -i error
```

#### 특정 시간대 로그

```bash
docker-compose logs --since="2024-01-15T10:00:00" openai-email-bot
```

## 🚀 배포 자동화

### CI/CD 파이프라인 예시

#### GitHub Actions (.github/workflows/deploy.yml)

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Deploy to server
        uses: appleboy/ssh-action@v0.1.5
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.KEY }}
          script: |
            cd /path/to/mail_verify
            git pull origin main
            ./deploy.sh production
```

## 📚 추가 리소스

- [Docker 공식 문서](https://docs.docker.com/)
- [Docker Compose 문서](https://docs.docker.com/compose/)
- [Nginx 설정 가이드](https://nginx.org/en/docs/)
- [Redis 문서](https://redis.io/documentation)

## 🆘 지원

문제가 발생하면 다음을 확인하세요:

1. 로그 확인: `./deploy.sh logs`
2. 서비스 상태: `./deploy.sh status`
3. 환경 변수 설정
4. Docker 버전 호환성
5. 시스템 리소스 사용량

---

**Happy Deploying! 🚀**
