# Production deployment: Hostinger + PM2 + WAHA + n8n

This repository does not deploy to Vercel. Production runs as a Next.js 16 Node process behind Nginx on an Ubuntu VPS, managed by PM2. WAHA and n8n are separate services and must not be exposed without authentication.

## Required controls

- Nginx terminates TLS and proxies only required public routes.
- The Next.js process binds privately; PM2 restarts and persists the named process.
- Supabase service-role credentials exist only in the server environment.
- Public signup remains disabled. Admin and manager sessions require MFA/AAL2 for privileged APIs.
- Every WAHA session resolves to exactly one company through `WAHA_SESSION_COMPANY_MAP` or one unambiguous database mapping.
- WAHA sends `X-Webhook-Secret` matching `WAHA_WEBHOOK_SECRET`.
- `INTEGRATION_ALLOWED_HOSTS` lists public hostnames allowed for administrator-configured outbound integrations.
- n8n uses authentication, encrypted credentials, and webhook secrets; its editor is not public.

## Environment

```env
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENROUTER_API_KEY=sk-or-...
APP_SECRET=at-least-32-random-characters
NEXT_PUBLIC_APP_URL=https://YOUR_DOMAIN

WAHA_API_URL=http://127.0.0.1:3001
WAHA_API_KEY=...
WAHA_WEBHOOK_SECRET=...
WAHA_SESSION=default
WAHA_SESSION_COMPANY_MAP={"default":"COMPANY_UUID"}

INTEGRATION_ALLOWED_HOSTS=api.partner.example

# Required only when the inbound email channel is enabled.
EMAIL_INBOUND_SECRET=...
EMAIL_INBOUND_COMPANY_MAP={"collections+tenant@example.com":"COMPANY_UUID"}
```

Administrator-configured integration URLs are HTTPS-only in production and must resolve to public, allowlisted addresses.

## Pre-deploy gate

```bash
npm ci
npm run db:validate
npm run security:secrets
npm audit --omit=dev --audit-level=high
npm run typecheck
npm run test
npm run build
```

Apply migrations in numeric order before enabling dependent code. Migration `057_security_audit_remediation.sql` is required for tenant-scoped unmatched contacts and integration RLS hardening.

## Deploy and verify

`deploy.ps1` is the supported deployment script. Set `AI_DEBT_VPS_TARGET` and `AI_DEBT_PUBLIC_URL` (or pass `-VpsTarget` and `-PublicUrl`); the script refuses to deploy without an explicit active target.

```bash
pm2 status
pm2 logs ai-debt-os-admin-3000 --lines 100
curl --fail https://YOUR_DOMAIN/api/health
curl --fail https://YOUR_DOMAIN/api/health/waha-session
```

Send a controlled WAHA message for a test company and confirm it cannot resolve a customer belonging to another company.

## Rollback and secret rotation

The deployment script retains prior source as `src.bak` until the next deployment. Restore it and restart PM2 if health checks fail. Use a reviewed compensating migration for database rollback; never edit applied migrations.

If a credential was ever committed, deletion is insufficient. Rotate it first, update the server environment, restart affected services, verify health, then clean Git history during a coordinated maintenance window.
