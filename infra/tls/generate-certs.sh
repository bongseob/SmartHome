#!/usr/bin/env bash
# 프로덕션 배포용 자체 서명(사설 CA) 인증서 생성 스크립트 (PROJECT_RULES §5.1).
# 배포 인프라(K8s/VM 등, PROJECT_RULES 부록 A.2)가 아직 미정이라 공인 CA(Let's Encrypt 등)
# 대신 사설 CA로 시작한다 — 도메인 없이 내부망/폐쇄망 배포와도 바로 맞는다.
#
# 사용법:
#   infra/tls/generate-certs.sh [SAN1,SAN2,...]
#   예) infra/tls/generate-certs.sh mosquitto.smarthome.local,192.168.0.10
#
# SAN을 안 주면 localhost/127.0.0.1만 들어간다 — 실제 배포 호스트명/IP를 반드시 넘길 것.
# 생성물은 infra/tls/out/ 아래(전부 .gitignore 대상, 커밋 금지 — 개인키 포함).
#
# 산출물:
#   out/ca.crt, ca.key       사설 루트 CA (모든 클라이언트가 이 ca.crt를 신뢰해야 함)
#   out/mosquitto.crt/.key   Mosquitto 서버 인증서(mqtts 8883 / wss 9002)
#   out/api.crt/.key         apps/api 서버 인증서(https/wss 3000)
#
# 재발급(로테이션) 시 그냥 다시 실행 — 매번 새 키/인증서를 만든다. 기존 클라이언트가 예전
# ca.crt를 들고 있으면 새 ca.crt로 다시 배포해야 연결된다.
set -euo pipefail

# Git Bash(MSYS)에서 "/O=..." 같은 openssl -subj 값을 Windows 경로로 오인해 변환하는 문제 방지.
# 순수 Linux 배포 호스트에서는 이 변수 자체가 읽히지 않아 무해하다.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/out"
DAYS_CA=3650
DAYS_LEAF=825   # 공개 CA 관행(브라우저 최대 신뢰 기간)에 맞춰 최대 825일로 제한

EXTRA_SANS="${1:-}"

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

echo "[1/4] 사설 루트 CA 생성..."
openssl req -x509 -newkey rsa:4096 -sha256 -days "$DAYS_CA" -nodes \
  -keyout ca.key -out ca.crt \
  -subj "/O=SmartHome/CN=SmartHome Internal CA"

IP_RE='^[0-9]{1,3}(\.[0-9]{1,3}){3}$'

# 콤마 구분 SAN 목록을 openssl subjectAltName 형식으로 변환한다.
# 각 항목이 IPv4 형태(x.x.x.x)면 IP:, 아니면 DNS:로 태깅한다(IP를 DNS:로 잘못 넣으면
# 클라이언트가 IP로 접속할 때 hostname 검증에 실패한다).
tag_sans() {
  local input="$1" out="" entry
  IFS=',' read -ra parts <<< "$input"
  for entry in "${parts[@]}"; do
    [ -z "$entry" ] && continue
    if [[ "$entry" =~ $IP_RE ]]; then
      out="${out}${out:+,}IP:$entry"
    else
      out="${out}${out:+,}DNS:$entry"
    fi
  done
  echo "$out"
}

generate_leaf() {
  local name="$1"
  local cn="$2"
  local sans="DNS:localhost,IP:127.0.0.1${EXTRA_SANS:+,$(tag_sans "$EXTRA_SANS")}"

  echo "[..] $name 서버 키/CSR 생성 (CN=$cn)..."
  openssl req -newkey rsa:2048 -sha256 -nodes \
    -keyout "$name.key" -out "$name.csr" \
    -subj "/O=SmartHome/CN=$cn"

  local extfile="$name.ext.tmp"
  printf "subjectAltName=%s\nextendedKeyUsage=serverAuth" "$sans" > "$extfile"

  openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "$name.crt" -days "$DAYS_LEAF" -sha256 \
    -extfile "$extfile"

  rm -f "$name.csr" "$extfile"
}

echo "[2/4] mosquitto 서버 인증서 생성..."
generate_leaf mosquitto mosquitto.smarthome.local

echo "[3/4] api 서버 인증서 생성..."
generate_leaf api api.smarthome.local

chmod 600 ./*.key
rm -f ca.srl

echo "[4/4] 완료. 산출물: $OUT_DIR"
echo "  - ca.crt 를 모든 백엔드(MQTT_CA_FILE)/ESP32 보드(MQTT_CA_CERT)에 배포하세요."
echo "  - mosquitto.crt/.key 는 infra/mosquitto/tls/ 로, api.crt/.key 는 apps/api용 TLS_CERT_FILE/TLS_KEY_FILE로 복사하세요."
