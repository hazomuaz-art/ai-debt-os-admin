# AI Debt Operating System

Production-ready SaaS debt collection platform with AI-powered scoring, WhatsApp integration, and multi-role dashboards.

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Backend**: Supabase (Auth + PostgreSQL + RLS), Next.js API Routes
- **AI**: OpenAI GPT-4o-mini (debt scoring, action planning, message generation)
- **Messaging**: Meta WhatsApp Cloud API
- **Deployment**: Vercel

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo>
cd ai-debt-os
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the migration:
   ```
   supabase/migrations/001_initial_schema.sql
   ```
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

OPENAI_API_KEY=sk-...

# WhatsApp (optional — app works without it)
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_ACCESS_TOKEN=your-permanent-token
WHATSAPP_VERIFY_TOKEN=any-random-string-you-choose
WHATSAPP_BUSINESS_ACCOUNT_ID=your-business-account-id

NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_SECRET=any-random-secret-32-chars
```

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to `/register` to create your company and admin account.

---

## Deploy to Vercel

### One-click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=YOUR_REPO_URL)

### Manual

```bash
npm i -g vercel
vercel
```

Set the environment variables in the Vercel dashboard under **Settings → Environment Variables**.

### WhatsApp Webhook

After deploying, configure the webhook in your Meta App Dashboard:

- **Callback URL**: `https://your-app.vercel.app/api/whatsapp/webhook`
- **Verify Token**: Same as `WHATSAPP_VERIFY_TOKEN` in your env
- **Subscribe to**: `messages`, `message_status_updates`

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
| GET/POST | `/api/whatsapp/webhook` | Meta webhook handler |
| POST | `/api/auth/invite` | Invite team member |
