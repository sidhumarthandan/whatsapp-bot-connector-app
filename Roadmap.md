WhatsApp Groups Integration – Make.com + NestJS

Technical Implementation Document
Version: 1.0
Status: Development Planning

1. Project Overview
Objective

Integrate WhatsApp Groups with a NestJS backend using Make.com and Meta WhatsApp Business Platform.

The system should support three major functionalities:

Identify which WhatsApp group a user interacted with and which menu option they selected.
Fetch and maintain group information and participant details.
Send messages dynamically from NestJS to the appropriate WhatsApp group.
Technology Stack
Component	Technology
Backend	NestJS
Programming Language	TypeScript
Automation	Make.com
Messaging Platform	Meta WhatsApp Business Platform
API Integration	Meta Graph API
Database	PostgreSQL
ORM	TypeORM
HTTP Client	Axios
2. System Architecture
text
              WHATSAPP
          ┌───────────────┐
          │               │
       Group A         Group B
          │               │
          └───────┬───────┘
                  │
                  ▼
          META WHATSAPP API
                  │
                  ▼
             WEBHOOK
                  │
                  ▼
             NESTJS APP
          ┌───────┴────────┐
          │                │
          ▼                ▼
     Phase 1            Phase 2
  Menu Identification  Group Details
          │                │
          └───────┬────────┘
                  │
                  ▼
              DATABASE
                  │
                  ▼
              MAKE.COM
                  │
                  ▼
             NESTJS API
                  │
                  ▼
          META WHATSAPP API
                  │
                  ▼
          TARGET WHATSAPP GROUP

Important Platform Limitation

The official WhatsApp Groups API does not currently support interactive list messages or interactive reply buttons inside groups.

Therefore, the initial implementation should use text-based menu options:

text
Welcome!

Please select an option:

1. Menu One
2. Menu Two

Reply with 1 or 2.


The architecture must use Meta's official Groups API, subject to account eligibility and supported group functionality.

Existing personal WhatsApp groups cannot automatically be connected to the official Groups API.

3. Base Development Setup
3.1 Create NestJS Application
bash
npm install -g @nestjs/cli

nest new whatsapp-group-integration

cd whatsapp-group-integration

3.2 Install Dependencies
bash
npm install @nestjs/config
npm install @nestjs/axios axios
npm install class-validator class-transformer
npm install @TypeORM/client

npm install -D TypeORM

3.3 Generate Modules
bash
nest g module whatsapp
nest g controller whatsapp
nest g service whatsapp

nest g module groups
nest g controller groups
nest g service groups

3.4 Project Structure
text
whatsapp-group-integration/
│
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── whatsapp/
│   │   ├── whatsapp.module.ts
│   │   ├── whatsapp.controller.ts
│   │   ├── whatsapp.service.ts
│   │   └── whatsapp.types.ts
│   │
│   ├── groups/
│   │   ├── groups.module.ts
│   │   ├── groups.controller.ts
│   │   └── groups.service.ts
│   │
│   └── common/
│       └── guards/
│
├── TypeORM/
│   └── schema.TypeORM
│
├── .env
└── package.json

3.5 Environment Configuration

Create .env:

env
PORT=3000

META_ACCESS_TOKEN=YOUR_ACCESS_TOKEN
META_APP_SECRET=YOUR_APP_SECRET
META_VERIFY_TOKEN=YOUR_VERIFY_TOKEN

WHATSAPP_PHONE_NUMBER_ID=YOUR_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID=YOUR_WABA_ID

META_API_VERSION=YOUR_SUPPORTED_API_VERSION

DATABASE_URL=postgresql://user:password@localhost:5432/whatsapp_db


Never commit .env into Git.

3.6 Configure AppModule

src/app.module.ts

typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { WhatsappModule } from './whatsapp/whatsapp.module';
import { GroupsModule } from './groups/groups.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    WhatsappModule,
    GroupsModule,
  ],
})
export class AppModule {}

3.7 Configure Main Application

src/main.ts

typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  await app.listen(process.env.PORT || 3000);
}

bootstrap();

3.8 Meta Developer Configuration

Create and configure a Meta Developer application.

Required credentials:

WhatsApp Business Account ID
Phone Number ID
Permanent access token
App secret
Webhook verification token
Groups API eligibility

Configure the webhook URL:

text
https://your-domain.com/webhook/whatsapp


Subscribe to the required supported webhook fields.

The backend must validate incoming webhook signatures.

4. Phase 1 – Group Identification and Menu Selection
4.1 Objective

Identify:

Which WhatsApp group generated the event.
Which user interacted with the bot.
Which menu option the user selected.

Two groups will be created.

Group A

text
Welcome!

1. Menu One
2. Menu Two


Group B

text
Welcome!

1. Menu One
2. Menu Two

4.2 Expected Behaviour
WhatsApp Group	User Selection	NestJS Result
Group A	1	GROUP_A + MENU_1
Group A	2	GROUP_A + MENU_2
Group B	1	GROUP_B + MENU_1
Group B	2	GROUP_B + MENU_2
4.3 Incoming Webhook

Meta sends incoming message events to the configured webhook.

Illustrative payload:

json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "changes": [
        {
          "value": {
            "messages": [
              {
                "from": "919876543210",
                "id": "wamid.XXXX",
                "timestamp": "1795690000",
                "type": "text",
                "text": {
                  "body": "1"
                },
                "group_id": "GROUP_ID_A"
              }
            ]
          }
        }
      ]
    }
  ]
}


The actual webhook payload must be mapped using the current Meta Groups API schema.

4.4 Create Webhook Controller

src/whatsapp/whatsapp.controller.ts

typescript
import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  HttpCode,
} from '@nestjs/common';

import { Response } from 'express';
import { WhatsappService } from './whatsapp.service';

@Controller('webhook/whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (
      mode === 'subscribe' &&
      token === process.env.META_VERIFY_TOKEN
    ) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  }

  @Post()
  @HttpCode(200)
  async receiveWebhook(@Body() payload: any) {
    await this.whatsappService.processWebhook(payload);

    return {
      success: true,
    };
  }
}

4.5 Process Incoming Messages

src/whatsapp/whatsapp.service.ts

typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(
    WhatsappService.name,
  );

  async processWebhook(payload: any) {
    const entries = payload.entry || [];

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value;

        for (const message of value.messages || []) {
          await this.processIncomingMessage(message);
        }
      }
    }
  }

  async processIncomingMessage(message: any) {
    const groupId = message.group_id;
    const userPhone = message.from;

    const messageText =
      message.text?.body?.trim();

    if (!groupId) {
      this.logger.log('Individual message received');
      return;
    }

    let selectedMenu = '';

    if (messageText === '1') {
      selectedMenu = 'MENU_1';
    } else if (messageText === '2') {
      selectedMenu = 'MENU_2';
    }

    if (!selectedMenu) {
      this.logger.warn(
        `Invalid menu response: ${messageText}`,
      );
      return;
    }

    this.logger.log(
      '========== GROUP INTERACTION ==========',
    );

    this.logger.log(`Group ID: ${groupId}`);
    this.logger.log(`User: ${userPhone}`);
    this.logger.log(`Menu: ${selectedMenu}`);

    this.logger.log(
      '=======================================',
    );

    // Phase 2: Update group information
    // Phase 3: Send group response
  }
}

4.6 Expected Console Output
text
========== GROUP INTERACTION ==========

Group ID : GROUP_ID_A
User     : 919876543210
Menu     : MENU_1

=======================================

4.7 Phase 1 Completion Criteria
Both groups can send messages.
NestJS receives incoming webhook events.
Group ID is identified.
User ID is identified.
Menu 1 and Menu 2 are identified.
Invalid inputs are handled.
Duplicate webhook events are handled.
5. Phase 2 – Fetch and Maintain Group Information
5.1 Objective

Whenever a user interacts with the bot, the backend should identify the group and retrieve available group information.

Information to maintain:

Group ID
Group name
Group status
Participant IDs
Participant status
Interaction history
Created and updated timestamps where available
5.2 Group Webhook Events

Subscribe to supported Groups API webhook fields:

Event	Purpose
group_lifecycle_update	Group lifecycle changes
group_participants_update	Participant join/leave changes
group_settings_update	Group settings updates
group_status_update	Group status updates

Verify exact field names and supported operations against the current Meta documentation.

5.3 Database Design

Three main tables will be maintained.

Table 1: whatsapp_groups
Column	Type
id	UUID
whatsapp_group_id	VARCHAR
group_name	VARCHAR
status	VARCHAR
created_at	TIMESTAMP
updated_at	TIMESTAMP
Table 2: group_participants
Column	Type
id	UUID
group_id	UUID
whatsapp_user_id	VARCHAR
status	VARCHAR
joined_at	TIMESTAMP
Table 3: menu_interactions
Column	Type
id	UUID
group_id	UUID
user_phone	VARCHAR
menu_id	VARCHAR
message_id	VARCHAR
clicked_at	TIMESTAMP
5.4 TypeORM Configuration

TypeORM/schema.TypeORM

TypeORM
model WhatsappGroup {
  id              String   @id @default(uuid())
  whatsappGroupId String   @unique
  groupName       String?
  status          String   @default("ACTIVE")

  participants    GroupParticipant[]
  interactions    MenuInteraction[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model GroupParticipant {
  id             String   @id @default(uuid())
  groupId        String
  whatsappUserId String
  status         String   @default("ACTIVE")

  group          WhatsappGroup @relation(
    fields: [groupId],
    references: [id]
  )

  joinedAt       DateTime @default(now())

  @@unique([groupId, whatsappUserId])
}

model MenuInteraction {
  id        String   @id @default(uuid())
  groupId   String
  userPhone String
  menuId    String
  messageId String   @unique
  clickedAt DateTime @default(now())

  group     WhatsappGroup @relation(
    fields: [groupId],
    references: [id]
  )
}

5.5 Run Database Migration
bash
npx TypeORM init

npx TypeORM migrate dev --name init

5.6 Group Information Workflow
text
Incoming WhatsApp Message
          |
          v
Extract Group ID
          |
          v
Check Database
          |
     ┌────┴─────┐
     |          |
   Exists     New Group
     |          |
     v          v
   Update     Create
     |          |
     └────┬─────┘
          |
          v
Fetch Available Group Metadata
          |
          v
Process Participant Information
          |
          v
Save to PostgreSQL


Important: Do not assume an incoming message contains the entire group metadata. Use the supported Groups API operations and lifecycle webhooks to retrieve and maintain group information.

5.7 Phase 2 Completion Criteria
Group information is stored.
Group name is maintained where available.
Participant information is maintained.
Join/leave events are processed.
Interaction history is stored.
Duplicate records are prevented.
6. Phase 3 – Send Messages from NestJS to WhatsApp Groups
6.1 Objective

The NestJS application should be able to send messages to a specific WhatsApp group dynamically.

Example:

text
Group ID: GROUP_ID_A

Message:
Welcome! You selected Menu 1.


Only the intended group should receive the message.

6.2 Meta API Endpoint
http
POST https://graph.facebook.com/{API_VERSION}/{PHONE_NUMBER_ID}/messages


Headers:

http
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json


Request body:

json
{
  "messaging_product": "whatsapp",
  "recipient_type": "group",
  "to": "GROUP_ID_A",
  "type": "text",
  "text": {
    "body": "Welcome! You selected Menu 1."
  }
}


Use the current official Groups API messaging specification.

6.3 Create Message Sending Service

Add this method to whatsapp.service.ts:

typescript
import axios from 'axios';

async sendGroupMessage(
  groupId: string,
  message: string,
) {
  const phoneNumberId =
    process.env.WHATSAPP_PHONE_NUMBER_ID;

  const accessToken =
    process.env.META_ACCESS_TOKEN;

  const apiVersion =
    process.env.META_API_VERSION;

  const url =
    `https://graph.facebook.com/${apiVersion}/` +
    `${phoneNumberId}/messages`;

  const response = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'group',
      to: groupId,
      type: 'text',
      text: {
        body: message,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );

  this.logger.log(
    `Message submitted to group: ${groupId}`,
  );

  return response.data;
}

6.4 Create NestJS Send Message API

Add the following endpoint to whatsapp.controller.ts:

typescript
@Post('send-group-message')
async sendGroupMessage(
  @Body()
  body: {
    groupId: string;
    message: string;
  },
) {
  return this.whatsappService.sendGroupMessage(
    body.groupId,
    body.message,
  );
}


API endpoint:

http
POST /webhook/whatsapp/send-group-message


Request:

json
{
  "groupId": "GROUP_ID_A",
  "message": "Hello Group A!"
}


Production implementation must validate the request, verify the group against registered groups, and enforce authentication.

6.5 Automatic Reply Based on Menu Selection

Integrate Phase 1 and Phase 3.

Inside processIncomingMessage():

typescript
if (selectedMenu === 'MENU_1') {
  await this.sendGroupMessage(
    groupId,
    'You selected Menu 1. Thank you!',
  );
}

if (selectedMenu === 'MENU_2') {
  await this.sendGroupMessage(
    groupId,
    'You selected Menu 2. Thank you!',
  );
}


Expected workflow:

text
User sends menu selection
          |
          v
NestJS receives message
          |
          v
Identifies Group ID
          |
          v
Identifies Menu Selection
          |
          v
Fetches/updates group information
          |
          v
Sends message to same group

6.6 Phase 3 Completion Criteria
NestJS can send messages to Group A.
NestJS can send messages to Group B.
Dynamic group ID is supported.
Correct destination group is selected.
Message IDs are stored.
Delivery status is tracked.
7. Make.com Integration
7.1 Role of Make.com

Make.com will be used for workflow automation and connecting external business processes.

NestJS will remain the central backend responsible for:

Group identification
Menu selection
Database management
Group information
Message routing
API validation
7.2 Scenario 1 – Incoming Interaction Automation
text
Meta WhatsApp Webhook
          |
          v
NestJS Webhook
          |
          v
Validate Incoming Event
          |
          v
Identify Group and Menu
          |
          v
Save Interaction
          |
          v
Make.com Custom Webhook
          |
          v
Business Automation

Make.com Configuration
Create a new scenario.
Add Webhooks → Custom Webhook.
Create a webhook endpoint.
Copy the webhook URL.
Configure NestJS to send normalized interaction data to Make.com.
Add filters for group IDs and menu IDs.
Add further HTTP modules if required.

Example event:

json
{
  "event": "WHATSAPP_MENU_SELECTED",
  "groupId": "GROUP_ID_A",
  "userId": "919876543210",
  "menuId": "MENU_1",
  "messageId": "wamid.XXXX"
}

7.3 Scenario 2 – Outgoing Message Automation
text
Make.com Trigger
        |
        v
Business Logic
        |
        v
HTTP Request
        |
        v
NestJS Send Message API
        |
        v
Meta WhatsApp Groups API
        |
        v
Target WhatsApp Group


Make.com can trigger the NestJS send-message endpoint with a dynamic group ID.

Note: Standard Make.com WhatsApp modules should not be assumed to support Groups API-specific operations. Use HTTP modules and the official API where necessary.

8. Complete Testing Scenarios
Test Case	Input	Expected Result
TC01	Group A sends 1	GROUP_A + MENU_1
TC02	Group A sends 2	GROUP_A + MENU_2
TC03	Group B sends 1	GROUP_B + MENU_1
TC04	Group B sends 2	GROUP_B + MENU_2
TC05	Invalid response	Handle invalid input
TC06	New participant joins	Participant record updated
TC07	Participant leaves	Participant status updated
TC08	NestJS sends to Group A	Group A receives message
TC09	NestJS sends to Group B	Group B receives message
TC10	Duplicate webhook	No duplicate interaction
9. Security and Production Requirements
Validate Meta webhook signatures using the app secret.
Store access tokens securely.
Never expose Meta access tokens in API responses.
Validate incoming group IDs.
Implement webhook idempotency using message IDs.
Handle API failures and retries.
Store outgoing message IDs.
Track sent, delivered, and failed statuses.
Authenticate NestJS outgoing-message APIs.
Respect WhatsApp platform policies and participant privacy.
10. Development Roadmap
Stage	Development Activity
Base	NestJS project setup
Base	Meta developer configuration
Base	Make.com configuration
Base	PostgreSQL setup
Phase 1	Group creation and setup
Phase 1	Webhook integration
Phase 1	Group ID identification
Phase 1	Menu identification
Phase 2	Group metadata retrieval
Phase 2	Participant management
Phase 2	Interaction history
Phase 3	Group message service
Phase 3	Dynamic message routing
Phase 3	Make.com integration
Final	Security and testing
Final	Production deployment
11. Official Documentation
Meta WhatsApp Business Platform: https://developers.facebook.com/docs/whatsapp/
WhatsApp Groups API: https://developers.facebook.com/docs/whatsapp/cloud-api/groups/
WhatsApp Cloud API Messages: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
WhatsApp Webhooks: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/
Make.com WhatsApp Business Cloud: https://www.make.com/en/integrations/whatsapp-business-cloud
NestJS Documentation: https://docs.nestjs.com/
TypeORM Documentation: https://www.TypeORM.io/docs
12. Final Acceptance Criteria

The project is complete when:

Two eligible WhatsApp groups are connected.
Each group can receive the supported two-option menu.
A user selection reaches NestJS.
NestJS identifies the exact group and selected menu.
Group information is maintained in PostgreSQL.
Participant changes are tracked where supported.
NestJS can send messages dynamically to either group.
Make.com can participate in the automation workflow.
All required test cases pass.
13. Recommended Implementation Order

Development should start with Phase 1.

Before implementing the remaining phases, verify:

Meta Groups API eligibility.
Group creation and management permissions.
Incoming group webhook payload.
Outgoing group messaging capability.
Text-based menu interaction.

Once Phase 1 is verified, continue with Phase 2 and Phase 3.

Final architecture principle: NestJS owns the core business logic, PostgreSQL stores the group and interaction data, Meta WhatsApp Groups API handles group messaging, and Make.com orchestrates external automation workflows.