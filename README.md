# WhatsApp Groups Bot Connector Application

A lightweight NestJS backend service integrating WhatsApp Groups with Meta WhatsApp Business Platform and Make.com workflows, using in-memory JSON data structures (no DB required).

---

## Features

- **Meta WhatsApp Webhook Integration**:
  - Verification endpoint (`GET /webhook/whatsapp`)
  - Webhook event receiver (`POST /webhook/whatsapp`)
- **Signature Verification**: Validates Meta's `X-Hub-Signature-256` HMAC SHA-256 signatures for webhook authenticity.
- **Group Interaction Identification**: Automatically detects WhatsApp group ID (`group_id`), participant phone number (`from`), and menu selection (`1` -> `MENU_1`, `2` -> `MENU_2`).
- **Idempotency & Deduplication**: Prevents duplicate webhook events using in-memory bounded cache.
- **In-Memory / JSON Data Store**: Maintains dummy WhatsApp groups (`GROUP_ID_A`, `GROUP_ID_B`), participants, and interaction history directly in memory via REST routes.
- **Dynamic Group Messaging**:
  - Direct message sending endpoint: `POST /webhook/whatsapp/send-group-message`
  - Automatic replies to groups when menu options are selected
- **Make.com Integration**: Event forwarding to Make.com custom webhooks for automated business workflows.

---

## Available API Routes

### 1. Webhook Routes (`/webhook/whatsapp`)
- `GET /webhook/whatsapp` – Meta Webhook Challenge verification (`hub.mode`, `hub.verify_token`, `hub.challenge`)
- `POST /webhook/whatsapp` – Receives incoming WhatsApp messages/events
- `POST /webhook/whatsapp/send-group-message` – Sends dynamic message to a WhatsApp group

### 2. Groups Routes (`/groups`)
- `GET /groups` – List all groups with participants and interactions
- `GET /groups/:id` – Get details for a specific group (by UUID or WhatsApp Group ID)
- `GET /groups/:id/interactions` – List all menu interactions for a group
- `POST /groups` – Register or update a group
- `POST /groups/:id/participants` – Add or update a participant in a group

---

## Environment Configuration

Configuration is located in `.env`:

```env
PORT=3000

# Meta Developer & WhatsApp API Credentials
META_ACCESS_TOKEN=test_access_token
META_APP_SECRET=test_app_secret
META_VERIFY_TOKEN=test_verify_token

WHATSAPP_PHONE_NUMBER_ID=test_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=test_waba_id

META_API_VERSION=v21.0

# Make.com Integration (Optional)
MAKE_WEBHOOK_URL=
```

---

## Build & Run

1. **Build the application:**
   ```bash
   npm run build
   ```

2. **Start Development Server:**
   ```bash
   npm run start:dev
   ```

3. **Start Production Server:**
   ```bash
   npm run start:prod
   ```

---

## Testing Scenarios

### Webhook Verification (GET)
```bash
curl "http://localhost:3000/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=test_verify_token&hub.challenge=test_challenge_123"
```

### Incoming Menu Selection (POST)
```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "WABA_ID",
      "changes": [{
        "field": "messages",
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "1234567890",
            "phone_number_id": "test_phone_id"
          },
          "messages": [{
            "from": "919876543210",
            "id": "wamid.SAMPLE_MSG_001",
            "timestamp": "1732626000",
            "type": "text",
            "text": { "body": "1" },
            "group_id": "GROUP_ID_A"
          }]
        }
      }]
    }]
  }'
```

### Send Group Message (POST)
```bash
curl -X POST http://localhost:3000/webhook/whatsapp/send-group-message \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "GROUP_ID_A",
    "message": "Hello Group A!"
  }'
```

### Query Groups & Interactions (GET)
```bash
curl http://localhost:3000/groups
curl http://localhost:3000/groups/GROUP_ID_A
curl http://localhost:3000/groups/GROUP_ID_A/interactions
```
