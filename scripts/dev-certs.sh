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

append_env() {
  local key="$1"
  local value="$2"
  if [[ -f .env ]] && grep -q "^${key}=" .env; then
    return
  fi
  echo "${key}=${value}" >> .env
}

if [[ ! -f .env ]]; then
  DATA_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  HMAC_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  JWT_SECRET="$(openssl rand -hex 32)"
  cat > .env <<EOF
PORT=8443
DATA_KEY=${DATA_KEY}
HMAC_KEY=${HMAC_KEY}
JWT_SECRET=${JWT_SECRET}
DATABASE_URL=postgres://wifi:wifi@localhost:5434/wifi?sslmode=verify-full
REDIS_URL=rediss://localhost:6380
PGSSLROOTCERT=certs/ca.crt
REDIS_CA=certs/ca.crt
TLS_CERT=certs/server.crt
TLS_KEY=certs/server.key
DEEPSEEK_API_KEY=
APP_ORIGIN=http://localhost:5173
EMAIL_FROM=
RESEND_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=
EOF
  chmod 600 .env
else
  append_env JWT_SECRET "$(openssl rand -hex 32)"
  append_env APP_ORIGIN "http://localhost:5173"
  append_env EMAIL_FROM ""
  append_env RESEND_API_KEY ""
  append_env STRIPE_SECRET_KEY ""
  append_env STRIPE_WEBHOOK_SECRET ""
  append_env STRIPE_PRICE_ID ""
fi
raw_dir="android/app/src/main/res/raw"
if [[ -d android/app/src/main ]]; then
  mkdir -p "$raw_dir"
  cp certs/ca.crt "$raw_dir/dev_ca.crt"
fi
echo "Dev certificates and .env are ready."
