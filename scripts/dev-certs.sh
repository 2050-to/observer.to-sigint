#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p certs
if [[ ! -f certs/ca.crt ]]; then
  openssl req -x509 -newkey rsa:2048 -days 825 -nodes \
    -keyout certs/ca.key -out certs/ca.crt \
    -subj "/CN=wifi-mapping-dev-ca"
  openssl req -newkey rsa:2048 -nodes \
    -keyout certs/server.key -out certs/server.csr \
    -subj "/CN=localhost"
  openssl x509 -req -in certs/server.csr -CA certs/ca.crt -CAkey certs/ca.key \
    -CAcreateserial -out certs/server.crt -days 825 \
    -extfile <(printf "subjectAltName=DNS:localhost,DNS:postgres,DNS:redis,IP:127.0.0.1,IP:10.0.2.2")
  rm -f certs/server.csr certs/ca.srl
  chmod 600 certs/server.key certs/ca.key
fi
if [[ ! -f .env ]]; then
  DATA_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  HMAC_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  API_TOKEN="$(openssl rand -hex 24)"
  cat > .env <<EOF
PORT=8443
API_TOKEN=${API_TOKEN}
DATA_KEY=${DATA_KEY}
HMAC_KEY=${HMAC_KEY}
DATABASE_URL=postgres://wifi:wifi@localhost:5432/wifi?sslmode=verify-full
REDIS_URL=rediss://localhost:6379
PGSSLROOTCERT=certs/ca.crt
REDIS_CA=certs/ca.crt
TLS_CERT=certs/server.crt
TLS_KEY=certs/server.key
VITE_API_TOKEN=${API_TOKEN}
EOF
  chmod 600 .env
fi
raw_dir="android/app/src/main/res/raw"
if [[ -d android/app/src/main ]]; then
  mkdir -p "$raw_dir"
  cp certs/ca.crt "$raw_dir/dev_ca.crt"
fi
echo "Dev certificates and .env are ready."
