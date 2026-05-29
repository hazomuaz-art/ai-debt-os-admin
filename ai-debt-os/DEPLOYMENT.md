# Production Deployment Runbook

## Pre-Deploy Checklist

### 1. Environment Variables
```bash
node scripts/validate-env.js
```
All required vars must pass. See `.env.example` for the full list.

### 2. Run Tests
```bash
npm run test          # all tests
npm run typecheck     # TypeScript
npm run lint          # ESLint
```

### 3. Verify Build
```bash
npm run build
```
Must complete without errors. Type errors and lint errors fail the build.

---

## Supabase Setup

### First Deploy (new project)

1. Create project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run migrations **in order**:
   ```
   001_initial_schema.sql    — tables, triggers, helper functions
   002_fix_debt_status.sql   — status enum fix
   003_rls_hardening.sql     — all RLS policies (replaces 001 policies)
   004_jobs_ratelimits_audit.sql — job queue, rate limits, audit triggers
   005_auth_hardening.sql    — sessions, API keys, brute-force protection
   006_schema_fixes.sql      — column consistency
   007_pg_cron_jobs.sql      — scheduled cleanup (requires pg_cron extension)
   008_performance_optimization.sql — indexes, stats, optimized functions
   ```

3. Enable extensions (Dashboard → Database → Extensions):
   - `pg_cron` (for scheduled jobs)
   - `pg_stat_statements` (for query monitoring)
   - `uuid-ossp` (auto-enabled)

4. Configure Auth settings (Dashboard → Authentication → Settings):
   - **Site URL**: your production URL (e.g. `https://app.yourcompany.com`)
   - **Redirect URLs**: `https://app.yourcompany.com/**`
   - **JWT expiry**: 3600 (1 hour)
   - **Enable email confirmations**: Off (users are invited, not self-registering)
   - **Minimum password length**: 8

5. Set Auth Rate Limits (Dashboard → Authentication → Rate Limits):
   - Sign in: 10/hour per email
   - Sign up: 3/hour per IP

### Subsequent Deploys (migrations only)
```bash
# Via script (uses Supabase Management API):
SUPABASE_ACCESS_TOKEN=xxx SUPABASE_PROJECT_REF=yyy node scripts/migrate.js

# Via CLI:
supabase db push --db-url postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
```

### Verify RLS is Working
Run these in SQL Editor to confirm policies work correctly:

```sql
-- Should return 0 rows (no authenticated user)
SET request.jwt.claims TO '{}';
SELECT * FROM public.debts LIMIT 1;

-- Should return company-scoped rows only
-- (test with a real user JWT from your app)
```

---

## Vercel Setup

### First Deploy

1. Install Vercel CLI: `npm i -g vercel`
2. Link project: `vercel link`
3. Set environment variables:
   ```bash
   vercel env add NEXT_PUBLIC_SUPABASE_URL production
   vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
   vercel env add SUPABASE_SERVICE_ROLE_KEY production
   vercel env add OPENAI_API_KEY production
   vercel env add APP_SECRET production
   vercel env add NEXT_PUBLIC_APP_URL production
   vercel env add WHATSAPP_PHONE_NUMBER_ID production
   vercel env add WHATSAPP_ACCESS_TOKEN production
   vercel env add WHATSAPP_VERIFY_TOKEN production
   vercel env add WHATSAPP_BUSINESS_ACCOUNT_ID production
   ```
4. Deploy: `vercel --prod`

### Cron Jobs
`vercel.json` schedules `/api/jobs/worker` every 2 minutes.
- Requires **Vercel Pro** or higher for cron jobs
- The worker is also callable manually via `POST /api/jobs/worker` with `Authorization: Bearer {APP_SECRET}`

### Regions
Default region is `iad1` (US East). Change in `vercel.json` if your users are in the Middle East:
```json
"regions": ["fra1"]   // Frankfurt
```

---

## WhatsApp Cloud API Setup

### Prerequisites
- Meta Business account
- WhatsApp Business App created in Meta Developer Dashboard

### Steps

1. **Get credentials** (Meta Developer Dashboard → Your App → WhatsApp → API Setup):
   - `WHATSAPP_PHONE_NUMBER_ID` — from "Phone Number ID" field
   - `WHATSAPP_ACCESS_TOKEN` — generate a **Permanent Token** (not the temporary one)
   - `WHATSAPP_BUSINESS_ACCOUNT_ID` — from "WhatsApp Business Account ID"

2. **Set verify token**: pick any random string for `WHATSAPP_VERIFY_TOKEN`

3. **Register webhook** (Meta Developer Dashboard → Your App → WhatsApp → Configuration):
   - Callback URL: `https://your-app.vercel.app/api/whatsapp/webhook`
   - Verify token: your `WHATSAPP_VERIFY_TOKEN` value
   - Subscribe to: `messages`, `message_status_updates`

4. **Test webhook**:
   ```bash
   curl "https://your-app.vercel.app/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"
   # Should return: test123
   ```

5. **Test message send**:
   ```bash
   curl -X POST https://your-app.vercel.app/api/whatsapp/send \
     -H "Content-Type: application/json" \
     -H "Cookie: [your session cookie]" \
     -d '{"phone":"+966501234567","message":"Test message","debt_id":"[uuid]"}'
   ```

### Production Phone Number
Test numbers only allow messaging pre-approved numbers. To message any number:
- Submit your **Business Verification** in Meta Business Manager
- Get your number **approved** for production

---

## Monitoring

### Health Check
```bash
curl https://your-app.vercel.app/api/health
```
Returns 200 (healthy) or 503 (unhealthy) with check breakdown.

### Job Queue
```bash
curl -H "Authorization: Bearer $APP_SECRET" \
  https://your-app.vercel.app/api/jobs/worker
```

### Database Monitoring (Supabase Dashboard)
- **Slow queries**: Dashboard → Database → Query Performance
- **Table sizes**: Dashboard → Database → Database Size
- **RLS policy performance**: Run `EXPLAIN ANALYZE` on slow queries in SQL Editor

### Logs
- **Vercel**: Dashboard → Project → Logs (filterable by function/route)
- **Supabase**: Dashboard → Database → Logs
- Application logs are JSON-structured in production for log aggregator ingestion

---

## Rollback Procedure

### Vercel (instant)
```bash
vercel rollback [deployment-url]
```
Or via Dashboard → Project → Deployments → promote previous deployment.

### Database
Migrations are additive (no DROP TABLE). To roll back:
1. Identify which migration caused the issue
2. Write a compensating migration (e.g., drop the new column, restore old policy)
3. Apply it as the next migration number

There is no automated rollback — this is intentional to protect data integrity.

---

## Performance Baselines (post-deploy validation)

| Query | Expected P95 |
|-------|-------------|
| Admin dashboard load | < 800ms |
| Debt list (20 items) | < 200ms |
| AI score (OpenAI call) | < 5s |
| WhatsApp send | < 3s |
| Health check | < 500ms |
| Job worker run (10 jobs) | < 25s |

Run `EXPLAIN ANALYZE` in Supabase SQL Editor if any query exceeds these thresholds.
