#!/bin/bash

# OpenAI Email Bot 배포 스크립트

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 로그 함수
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

# 환경 확인
check_environment() {
    log "환경 확인 중..."
    
    if ! command -v docker &> /dev/null; then
        error "Docker가 설치되지 않았습니다."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose가 설치되지 않았습니다."
        exit 1
    fi
    
    if [ ! -f ".env" ]; then
        error ".env 파일이 없습니다. 환경 변수를 설정해주세요."
        exit 1
    fi
    
    log "환경 확인 완료"
}

# 기존 컨테이너 정리
cleanup() {
    log "기존 컨테이너 정리 중..."
    docker-compose down --remove-orphans
    docker system prune -f
    log "정리 완료"
}

# 이미지 빌드
build() {
    log "Docker 이미지 빌드 중..."
    docker-compose build --no-cache
    log "빌드 완료"
}

# 서비스 시작
start() {
    log "서비스 시작 중..."
    docker-compose up -d
    log "서비스 시작 완료"
}

# 헬스체크
health_check() {
    log "헬스체크 중..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f http://localhost:3000/ > /dev/null 2>&1; then
            log "서비스가 정상적으로 실행되고 있습니다!"
            return 0
        fi
        
        log "시도 $attempt/$max_attempts - 서비스 대기 중..."
        sleep 10
        ((attempt++))
    done
    
    error "헬스체크 실패. 서비스가 정상적으로 시작되지 않았습니다."
    return 1
}

# 로그 확인
show_logs() {
    log "최근 로그 확인 중..."
    docker-compose logs --tail=50 -f
}

# 메인 함수
main() {
    local environment=${1:-development}
    
    log "OpenAI Email Bot 배포 시작 (환경: $environment)"
    
    case $environment in
        "production"|"prod")
            log "프로덕션 환경으로 배포합니다."
            export COMPOSE_FILE=docker-compose.prod.yml
            ;;
        "development"|"dev")
            log "개발 환경으로 배포합니다."
            export COMPOSE_FILE=docker-compose.yml
            ;;
        *)
            error "알 수 없는 환경: $environment"
            echo "사용법: $0 [development|production]"
            exit 1
            ;;
    esac
    
    check_environment
    cleanup
    build
    start
    health_check
    
    if [ $? -eq 0 ]; then
        log "배포가 성공적으로 완료되었습니다!"
        log "서비스 URL: http://localhost:3000"
        log "로그 확인: $0 logs"
    else
        error "배포에 실패했습니다."
        exit 1
    fi
}

# 명령어 처리
case "${1:-}" in
    "logs")
        show_logs
        ;;
    "stop")
        log "서비스 중지 중..."
        docker-compose down
        log "서비스 중지 완료"
        ;;
    "restart")
        log "서비스 재시작 중..."
        docker-compose restart
        log "서비스 재시작 완료"
        ;;
    "status")
        log "서비스 상태 확인 중..."
        docker-compose ps
        ;;
    "help"|"-h"|"--help")
        echo "OpenAI Email Bot 배포 스크립트"
        echo ""
        echo "사용법:"
        echo "  $0                    # 개발 환경 배포"
        echo "  $0 production         # 프로덕션 환경 배포"
        echo "  $0 logs              # 로그 확인"
        echo "  $0 stop              # 서비스 중지"
        echo "  $0 restart           # 서비스 재시작"
        echo "  $0 status            # 서비스 상태 확인"
        echo "  $0 help              # 도움말 표시"
        ;;
    *)
        main "$@"
        ;;
esac
