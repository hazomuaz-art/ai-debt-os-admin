# AI Debt OS — Exact Deployment Steps

## Prerequisites
- Node.js 20+ installed
- Git installed
- GitHub account
- Supabase account (free tier works)
- OpenAI account with API key
- Vercel account (free tier works; Pro required for cron jobs)

---

## STEP 1 — Supabase Project Setup

### 1.1 Create the project
1. Go to https://supabase.com → New Project
2. Name: `ai-debt-os` | Region: pick closest to your users | Password: save it
3. Wait ~2 minutes for provisioning

### 1.2 Collect your credentials
Go to **Settings → API** and copy:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`

### 1.3 Run migrations (in order — copy-paste each into SQL Editor)
Go to **SQL Editor** and run each file in order:

```
supabase/migrations/001_initial_schema.sql    ← tables, triggers, functions
supabase/migrations/002_fix_debt_status.sql   ← status enum
supabase/migrations/003_rls_hardening.sql     ← 28 RLS policies + indexes
supabase/migrations/004_jobs_ratelimits_audit.sql ← job queue, rate limits, audit triggers
supabase/migrations/005_auth_hardening.sql    ← sessions, API keys, brute-force
supabase/migrations/006_schema_fixes.sql      ← column consistency
supabase/migrations/007_pg_cron_jobs.sql      ← scheduled cleanup (needs pg_cron)
supabase/migrations/008_performance_optimization.sql ← indexes, optimized functions
supabase/migrations/009_migration_tracking.sql ← migration registry
```

### 1.4 Enable extensions
Go to **Database → Extensions** and enable:
- `pg_cron` ← required for scheduled jobs
- `pg_stat_statements` ← query performance monitoring

### 1.5 Configure Auth
Go to **Authentication → Settings**:
- **Site URL**: `https://your-app.vercel.app` (update after Vercel deploy)
- **Redirect URLs**: `https://your-app.vercel.app/**`
- **JWT expiry**: `3600`
- **Enable email confirmations**: **OFF** (users are invited, not self-registering publicly)
- **Minimum password length**: `8`

---

## STEP 2 — GitHub Repository

```bash
# Clone or download this project, then:
cd ai-debt-os

# Create repo on GitHub (do this on github.com first, then):
git remote add origin https://github.com/YOUR_USERNAME/ai-debt-os.git
git branch -M main
git push -u origin main
```

If you already have the git repo initialized (it is):
```bash
cd ai-debt-os
git remote add origin https://github.com/YOUR_USERNAME/ai-debt-os.git
git push -u origin main
```

---

## STEP 3 — Vercel Deployment

### 3.1 Install Vercel CLI and deploy
```bash
npm install -g vercel

# From inside the project directory:
vercel login
vercel link    # select "Create a new project" → name it "ai-debt-os"
```

### 3.2 Set environment variables
```bash
# Run these one by one — Vercel will prompt for the value each time

vercel env add NEXT_PUBLIC_SUPABASE_URL production
# paste: https://your-project-ref.supabase.co

vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
# paste: your anon key

vercel env add SUPABASE_SERVICE_ROLE_KEY production
# paste: your service role key

vercel env add OPENAI_API_KEY production
# paste: sk-proj-...

vercel env add APP_SECRET production
# paste: run `openssl rand -base64 32` to generate one

vercel env add NEXT_PUBLIC_APP_URL production
# paste: https://ai-debt-os.vercel.app  (or your custom domain)

# WhatsApp (skip these if not using WhatsApp yet):
vercel env add WHATSAPP_PHONE_NUMBER_ID production
vercel env add WHATSAPP_ACCESS_TOKEN production
vercel env add WHATSAPP_VERIFY_TOKEN production
vercel env add WHATSAPP_BUSINESS_ACCOUNT_ID production
```

### 3.3 Deploy to production
```bash
vercel --prod
```

Vercel will:
1. Install dependencies
2. Run `next build`
3. Deploy to `https://ai-debt-os.vercel.app`
4. Start running the cron job at `/api/jobs/worker` every 2 minutes

> **Note**: Cron jobs require **Vercel Pro** ($20/mo). On the free Hobby plan, cron jobs are disabled. The app works without them — AI scoring runs on-demand instead of in the background.

### 3.4 Update Supabase Site URL
After deploy, go back to **Supabase → Authentication → Settings** and update:
- **Site URL**: `https://ai-debt-os.vercel.app`
- **Redirect URLs**: `https://ai-debt-os.vercel.app/**`

---

## STEP 4 — First Admin Account

1. Open `https://ai-debt-os.vercel.app/register`
2. Fill in:
   - **Full Name**: your name
   - **Company Name**: your company
   - **Email**: your email
   - **Password**: 8+ characters
3. Click **Create Account** — you are redirected to `/dashboard/admin`

This creates your company workspace and your admin account. All subsequent users are invited via the **Team → Invite User** button in the dashboard.

---

## STEP 5 — WhatsApp Setup (optional)

### 5.1 Meta Developer setup
1. Go to https://developers.facebook.com → My Apps → Create App
2. App type: **Business** → Add **WhatsApp** product
3. Go to **WhatsApp → API Setup**:
   - Copy `Phone Number ID` → `WHATSAPP_PHONE_NUMBER_ID`
   - Generate a **Permanent Token** → `WHATSAPP_ACCESS_TOKEN`
   - Copy `WhatsApp Business Account ID` → `WHATSAPP_BUSINESS_ACCOUNT_ID`

### 5.2 Register the webhook
1. Go to **WhatsApp → Configuration → Webhook**
2. Click **Edit**:
   - **Callback URL**: `https://ai-debt-os.vercel.app/api/whatsapp/webhook`
   - **Verify Token**: same value as your `WHATSAPP_VERIFY_TOKEN` env var
3. Click **Verify and Save**
4. Subscribe to: `messages`, `message_status_updates`

### 5.3 Test it
```bash
# Verify the webhook handshake:
curl "https://ai-debt-os.vercel.app/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123"
# Should return: test123

# Test health check:
curl https://ai-debt-os.vercel.app/api/health
# Should return: {"status":"healthy",...}
```

---

## STEP 6 — Verify Everything Works

```bash
# 1. Health check
curl https://ai-debt-os.vercel.app/api/health | python3 -m json.tool

# 2. Job worker (replace APP_SECRET with your value)
curl -X GET https://ai-debt-os.vercel.app/api/jobs/worker \
  -H "Authorization: Bearer YOUR_APP_SECRET"
# Should return: {"message":"No jobs to process",...}

# 3. Run local deploy checklist
NEXT_PUBLIC_SUPABASE_URL=https://your-ref.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-key \
SUPABASE_SERVICE_ROLE_KEY=your-service-key \
OPENAI_API_KEY=sk-... \
APP_SECRET=your-secret \
NEXT_PUBLIC_APP_URL=https://ai-debt-os.vercel.app \
node scripts/deploy-check.js
# Should print: 13 passed, 0 failed
```

---

## Environment Variables Summary

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase → Settings → API |
| `OPENAI_API_KEY` | ✅ | platform.openai.com/api-keys |
| `APP_SECRET` | ✅ | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | ✅ | Your Vercel URL |
| `WHATSAPP_PHONE_NUMBER_ID` | ⬜ | Meta Developer Dashboard |
| `WHATSAPP_ACCESS_TOKEN` | ⬜ | Meta Developer Dashboard |
| `WHATSAPP_VERIFY_TOKEN` | ⬜ | Any random string you choose |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | ⬜ | Meta Developer Dashboard |
| `CRON_SECRET` | 🔄 | Auto-set by Vercel — do NOT set manually |

---

## CI/CD (GitHub Actions)

The `.github/workflows/ci.yml` pipeline runs automatically on every push to `main`:
1. TypeScript typecheck
2. ESLint
3. Unit + integration tests
4. Full production build
5. Deploy to Vercel (requires GitHub secrets)

### Add GitHub secrets for CI deploy
Go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

```
VERCEL_TOKEN          ← Vercel → Account Settings → Tokens
VERCEL_ORG_ID         ← Vercel → Account Settings (personal account = same as team ID)  
VERCEL_PROJECT_ID     ← Vercel → Project → Settings → General (copy Project ID)
PROD_APP_URL          ← https://ai-debt-os.vercel.app
STAGING_SUPABASE_URL  ← optional: staging Supabase project URL
STAGING_SUPABASE_ANON_KEY ← optional
STAGING_SERVICE_ROLE_KEY  ← optional
STAGING_APP_URL            ← optional
OPENAI_API_KEY        ← your OpenAI key
APP_SECRET            ← same value as Vercel env var
```

---

## Troubleshooting

**Build fails with "Module not found"**
→ Run `npm install` and commit the resulting `package-lock.json`

**"Invalid Supabase URL" on deploy**
→ Verify `NEXT_PUBLIC_SUPABASE_URL` starts with `https://` and ends with `.supabase.co`

**RLS error "permission denied for table X"**
→ Run migration `003_rls_hardening.sql` in Supabase SQL Editor

**WhatsApp webhook returns 403**
→ `WHATSAPP_VERIFY_TOKEN` in Vercel must exactly match what you entered in Meta Dashboard

**Cron jobs not running**
→ Vercel Hobby plan doesn't support cron. Upgrade to Pro, or manually call `GET /api/jobs/worker` with your `APP_SECRET` from an external scheduler (cron-job.org, GitHub Actions schedule, etc.)

**OpenAI scoring returns fallback scores**
→ Check `OPENAI_API_KEY` is valid. Fallback scoring still works — it's rule-based and reliable. Check Vercel function logs for the error message.
