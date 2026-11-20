#!/bin/sh
set -eu
cp /certs/server.crt /tmp/server.crt
cp /certs/server.key /tmp/server.key
cp /certs/ca.crt /tmp/ca.crt
chmod 600 /tmp/server.key
exec redis-server \
  --tls-port 6379 \
  --port 0 \
  --tls-cert-file /tmp/server.crt \
  --tls-key-file /tmp/server.key \
  --tls-ca-cert-file /tmp/ca.crt \
  --tls-auth-clients no \
  --save "" \
  --appendonly no
