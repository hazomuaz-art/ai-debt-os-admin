# AI Debt Operating System

Multi-tenant debt collection platform with AI-assisted workflows, WAHA WhatsApp integration, and role-based dashboards.

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Supabase (Auth + PostgreSQL + RLS), Next.js API Routes
- **AI**: OpenRouter/OpenAI-compatible API
- **Messaging**: WAHA; n8n is used for external automation where configured
- **Deployment**: Hostinger Ubuntu VPS, Nginx, PM2 (not Vercel)

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo>
cd ai-debt-os-admin
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Apply every file under `supabase/migrations/` in numeric order. Never apply only `001`; current features and security controls depend on later migrations.
3. Copy your project URL and keys from **Settings → API**

### 3. Configure Environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

OPENROUTER_API_KEY=sk-or-...

# WAHA (required for WhatsApp)
WAHA_API_URL=http://127.0.0.1:3001
WAHA_API_KEY=replace-me
WAHA_WEBHOOK_SECRET=replace-with-a-long-random-secret
WAHA_SESSION=default
# Every inbound session must map to exactly one company UUID.
WAHA_SESSION_COMPANY_MAP={"default":"company-uuid"}

# Comma-separated public hosts allowed for admin-configured outbound integrations.
INTEGRATION_ALLOWED_HOSTS=api.example.com

NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_SECRET=any-random-secret-32-chars
```

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Public self-registration is disabled; administrators create/invite users through the protected admin flow.

---

## Deploy to Hostinger/PM2

The supported production topology is documented in `DEPLOYMENT.md`. The deployment gate validates migrations, tracked secrets, production dependency vulnerabilities, type safety, tests, build output, PM2 restart, and `/api/health`. `vercel.json` is not a production deployment source of truth.

`DEPLOYMENT.md` is the single deployment runbook. Integration names, fields, and UI metadata have one code source in `src/lib/integration-catalog.ts`.

## Authoritative Code Sources

- Integration names, fields, and UI metadata: `src/lib/integration-catalog.ts`
- AI model identifiers by workload tier: `src/lib/ai-models.ts`
- Environment tenant-map parsing and UUID validation: `src/lib/tenant-map.ts`
- CSV escaping and download generation: `src/lib/csv.ts`
- Manager/collector debt detail implementation: `src/components/debt/RoleDebtDetailPage.tsx`
- Production deployment runbook: `DEPLOYMENT.md`

WAHA must send message events to `https://YOUR_DOMAIN/api/whatsapp/waha-webhook` with the `X-Webhook-Secret` header matching `WAHA_WEBHOOK_SECRET`.

---

## User Roles

| Role | Access |
|------|--------|
| **Admin** | Full access: all debts, customers, team management, analytics, AI actions, import/export |
| **Manager** | Portfolio view, team performance, AI actions, customers |
| **Collector** | Only their assigned debts, personal action queue, messaging |

## Inviting Team Members

As admin, go to **Team → Invite User**. Enter their email, name, role, and a temporary password. They can log in immediately.

---

## Key Features

### AI Debt Scoring
Each debt gets a 0-100 AI score based on:
- Days overdue
- Outstanding balance
- Payment history
- Customer income vs debt ratio
- Risk classification (Low / Medium / High / Critical)

### AI Daily Action Plan
Generates a prioritized action list for collectors — which debts to contact, what channel to use, and pre-written messages. Run from **AI Actions** page.

### WhatsApp Messaging
- Send templated messages directly from debt detail pages
- Inbound messages are automatically logged
- Delivery status tracked per message

### Bulk CSV Import
Import hundreds of debts at once. Download the template from **Debts → Import CSV**.

Required columns: `Name`, `Amount`

Optional: `Phone`, `WhatsApp`, `National ID`, `City`, `Employer`, `Monthly Income`, `Current Balance`, `Currency`, `Due Date`, `Status`, `Priority`, `Product Type`, `Account Number`, `Notes`

### CSV Export
Export your full portfolio or filtered views to CSV from **Debts → Export CSV**.

---

## Database Schema

Key tables:
- `companies` — tenant isolation
- `profiles` — users with roles (admin/manager/collector)
- `customers` — debtors
- `debts` — core debt records with balance tracking
- `payments` — payment history, auto-settles when balance = 0
- `messages` — WhatsApp/SMS conversation log
- `ai_scores` — historical AI scoring per debt
- `ai_actions` — daily AI-generated action plans
- `logs` — full audit trail

All tables have `company_id` with Row Level Security — tenants are fully isolated.

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/ai/score` | Score a debt with AI |
| POST | `/api/ai/recommend` | Generate daily action plan |
| GET | `/api/debts` | List debts with filters |
| DELETE | `/api/debts` | Delete a debt (admin) |
| GET | `/api/debts/export` | Export debts to CSV |
| POST | `/api/debts/import` | Import debts from CSV |
| GET | `/api/customers` | Search customers |
| POST | `/api/whatsapp/send` | Send WhatsApp message |
| POST | `/api/whatsapp/waha-webhook` | WAHA inbound webhook handler |
| POST | `/api/auth/invite` | Invite team member |
