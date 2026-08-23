# Deployment checklist

The authoritative production platform is Hostinger/Ubuntu + Nginx + PM2 + WAHA + n8n. See `DEPLOYMENT.md` for details.

1. Provision or restore the VPS and point the domain to its current public IP.
2. Install Node.js 20+, Nginx, PM2, WAHA, and n8n; keep service ports private.
3. Configure server-only environment values and TLS.
4. Set `WAHA_SESSION_COMPANY_MAP`, `WAHA_WEBHOOK_SECRET`, and `INTEGRATION_ALLOWED_HOSTS`.
5. Apply all migrations, including `057_security_audit_remediation.sql`.
6. Run migration validation, secret scan, production dependency audit, typecheck, tests, and build.
7. Set `AI_DEBT_VPS_TARGET` and `AI_DEBT_PUBLIC_URL`, then run `deploy.ps1`.
8. Verify PM2, health endpoints, WAHA inbound/outbound, and n8n authentication.
9. Rotate every credential previously committed to Git.

Public self-registration must remain disabled. Do not expose WAHA or n8n administrative interfaces directly to the Internet.
