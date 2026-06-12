# AI Debt OS — n8n Workflows Documentation

This document describes the required n8n workflows for the **AI Debt OS** platform, including webhook paths, payload structures, and expected behavior.

---

## 1. Outbound WhatsApp Message (`whatsapp-outbound`)
* **Webhook Path**: `/webhook/whatsapp-outbound`
* **Trigger Event**: `send_message`
* **Purpose**: Relays outbound messages from the Next.js admin dashboard to the Evolution API.

### Webhook Payload
```json
{
  "event": "send_message",
  "data": {
    "company_id": "aaaaaaaa-0000-4000-8000-000000000001",
    "customer_id": "dddd0001-0000-4000-8000-000000000001",
    "phone_number": "966501234567",
    "message": "السلام عليكم أحمد، نود تذكيرك بالدفعة المستحقة بقيمة 12,000 ر.س.",
    "instance_name": "ai-debt-main",
    "message_type": "text"
  },
  "metadata": {
    "company_id": "aaaaaaaa-0000-4000-8000-000000000001",
    "source": "next-app"
  }
}
```

### Flow Steps in n8n:
1. **Webhook Node**: Receives the POST request.
2. **HTTP Request Node**: Invokes the **Evolution API** to send the message:
   * **URL**: `{{$env.EVOLUTION_API_URL}}/message/sendText/{{$json.data.instance_name}}`
   * **Headers**: `apikey: {{$env.EVOLUTION_API_KEY}}`
   * **Body**:
     ```json
     {
       "number": "{{$json.data.phone_number}}",
       "text": "{{$json.data.message}}"
     }
     ```
3. **HTTP Request Node (Next.js Callback)**: Notifies the Next.js API `/api/n8n/webhook` with the event `campaign_progress` or message delivery update.

---

## 2. Inbound Message & AI Analysis (`ai-analyze`)
* **Webhook Path**: `/webhook/ai-analyze`
* **Trigger Event**: `incoming_message`
* **Purpose**: Triggered when a customer replies via WhatsApp. Analyzes sentiment, identifies payment promises, and generates smart replies.

### Webhook Payload
```json
{
  "event": "incoming_message",
  "data": {
    "company_id": "aaaaaaaa-0000-4000-8000-000000000001",
    "customer_id": "dddd0001-0000-4000-8000-000000000001",
    "debt_id": "eeee0001-0000-4000-8000-000000000001",
    "message": "سأقوم بالسداد نهاية الشهر إن شاء الله"
  },
  "metadata": {
    "company_id": "aaaaaaaa-0000-4000-8000-000000000001",
    "source": "whatsapp"
  }
}
```

### Flow Steps in n8n:
1. **Webhook Node**: Receives the inbound message.
2. **Supabase Node**: Fetch debt detail history and customer context.
3. **OpenAI / LLM Node**: Uses function calling to analyze the customer's text:
   * **Intent**: Payment Promise / Objection / Instalment Request.
   * **Objection Reason** (if Objections): Financial hardship, salary delay, disputed amount.
   * **Obtained Promise Date** (if Promise): End of month -> `2026-06-30`.
4. **Decision Split Node**:
   * If **Promise**: Triggers a database insert into `collection_promises`.
   * If **Dispute/Objection**: Creates a system alert and switches debt status to `disputed`.
5. **Next.js Webhook Node**: Calls `/api/n8n/webhook` with event `ai_reply_generated` containing the AI's generated response to be sent back via WhatsApp.

---

## 3. Collection System Sync (`collection-sync`)
* **Webhook Path**: `/webhook/collection-sync`
* **Trigger Event**: `sync_trigger`
* **Purpose**: Synchronizes customer details, payments, and statuses from external collection CRM systems into AI Debt OS.

### Flow Steps in n8n:
1. **Cron Trigger / Manual Webhook**: Fires every hour or on-demand.
2. **HTTP Request Node**: Fetches records from external collection system APIs.
3. **Format/Map Node**: Normailzes the columns (mapping custom statuses to `active`, `promised`, `legal`, etc.).
4. **Supabase Node**: Upserts records into `customers`, `debts`, and `payments`.
5. **Callback Webhook**: Calls `/api/n8n/webhook` with `sync_completed` event containing sync count and metrics.

---

## 4. Campaign Executor (`campaign-executor`)
* **Webhook Path**: `/webhook/campaign-executor`
* **Trigger Event**: `campaign_start` / `campaign_pause`
* **Purpose**: Safely schedules and dispatches collection campaigns with queue throttling to prevent WhatsApp number bans.

### Flow Steps in n8n:
1. **Webhook Node**: Receives start campaign event.
2. **Supabase Node**: Retrieves campaign target lists.
3. **Loop Node**: Iterates targets, applying a randomized delay (e.g., 30–90 seconds) between each message.
4. **Logic Check**: Evaluates "Stop Rules" (e.g., skips customers who already settled or promised in the last 24 hours).
5. **HTTP Outbound WhatsApp Node**: Calls Evolution API to send message.
6. **Next.js Webhook Node**: Updates campaign progress (`campaign_progress` event).

---

## 5. Promise Follow-up & Reminders (`promise-follow-up`)
* **Webhook Path**: `/webhook/promise-follow-up`
* **Trigger Event**: `follow_up_trigger`
* **Purpose**: Identifies upcoming and overdue promises and triggers automated WhatsApp reminders.

### Flow Steps in n8n:
1. **Cron Trigger**: Fires daily at 9:00 AM.
2. **Supabase Node**: Queries `collection_promises` where status is `pending` and due date is today or yesterday.
3. **Split Node**:
   * **Due Today**: Generates a friendly reminder message.
   * **Overdue**: Generates a firmer objection/escalation message.
4. **HTTP Outbound WhatsApp Node**: Calls Evolution API to send the follow-up reminder.
