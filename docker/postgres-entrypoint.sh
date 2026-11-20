#!/bin/bash
set -euo pipefail
cp /certs/server.crt /var/lib/postgresql/server.crt
cp /certs/server.key /var/lib/postgresql/server.key
cp /certs/ca.crt /var/lib/postgresql/ca.crt
chown postgres:postgres /var/lib/postgresql/server.crt /var/lib/postgresql/server.key /var/lib/postgresql/ca.crt
chmod 600 /var/lib/postgresql/server.key
exec docker-entrypoint.sh postgres \
  -c ssl=on \
  -c ssl_cert_file=/var/lib/postgresql/server.crt \
  -c ssl_key_file=/var/lib/postgresql/server.key \
  -c ssl_ca_file=/var/lib/postgresql/ca.crt
