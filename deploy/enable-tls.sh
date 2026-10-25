#!/usr/bin/env bash
# Issues the Let's Encrypt certificate for wiki.exmachina.systems once its DNS record points at this server.
# Safe to run repeatedly (e.g. from cron): exits quietly while DNS is not ready.
set -euo pipefail
DOMAIN=wiki.exmachina.systems
CRON=/etc/cron.d/wiki-enable-tls
SERVER_IP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || true)
DNS_IP=$(dig +short A "$DOMAIN" @1.1.1.1 | tail -1)

if [ -z "$DNS_IP" ] || { [ -n "$SERVER_IP" ] && [ "$DNS_IP" != "$SERVER_IP" ]; }; then
  echo "DNS de $DOMAIN aún no apunta a este servidor (dns=$DNS_IP server=$SERVER_IP)"; exit 0
fi

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --keep-until-expiring
nginx -t && systemctl reload nginx
rm -f "$CRON"   # job done
echo "TLS activo en https://$DOMAIN"
