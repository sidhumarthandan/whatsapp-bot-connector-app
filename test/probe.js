const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const axios = require('axios');
const { AppModule } = require('../dist/app.module');

async function runTests() {
  console.log('--- Initializing NestJS App for In-Memory Verification ---');
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: ['error', 'warn', 'log'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const server = await app.listen(3000, '127.0.0.1');
  const baseURL = 'http://127.0.0.1:3000';

  try {
    console.log('\n[TEST 1] Verifying Meta Webhook Challenge (GET /webhook/whatsapp)...');
    const verifyRes = await axios.get(`${baseURL}/webhook/whatsapp`, {
      params: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test_verify_token',
        'hub.challenge': 'CHALLENGE_ACCEPTED_777',
      },
    });
    console.log('Result 1: Status =', verifyRes.status, ', Challenge =', verifyRes.data);

    console.log('\n[TEST 2] Querying In-Memory Dummy Groups (GET /groups)...');
    const groupsRes = await axios.get(`${baseURL}/groups`);
    console.log('Result 2: Total Groups =', groupsRes.data.total);
    console.log('Groups List:', groupsRes.data.data.map(g => `${g.whatsappGroupId} (${g.groupName})`));

    console.log('\n[TEST 3] Simulating Incoming WhatsApp Message with Menu Selection (POST /webhook/whatsapp)...');
    const samplePayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'test_waba_id',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '1555001234',
                  phone_number_id: 'test_phone_number_id',
                },
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.PROBE_MSG_001',
                    timestamp: '1732626000',
                    type: 'text',
                    text: {
                      body: '1',
                    },
                    group_id: 'GROUP_ID_A',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const webhookRes = await axios.post(`${baseURL}/webhook/whatsapp`, samplePayload);
    console.log('Result 3: Webhook Receiver Status =', webhookRes.status, webhookRes.data);

    console.log('\n[TEST 4] Verifying Recorded Menu Interaction in Group A (GET /groups/GROUP_ID_A/interactions)...');
    const interactionsRes = await axios.get(`${baseURL}/groups/GROUP_ID_A/interactions`);
    console.log('Result 4: Group A Recorded Interactions =', interactionsRes.data.data);

    console.log('\n[TEST 5] Testing Dynamic Group Message Endpoint (POST /webhook/whatsapp/send-group-message)...');
    const sendRes = await axios.post(`${baseURL}/webhook/whatsapp/send-group-message`, {
      groupId: 'GROUP_ID_B',
      message: 'Hello Group B from automated route test!',
    });
    console.log('Result 5: Outbound Send Result =', sendRes.data);

    console.log('\n[TEST 6] Testing Idempotency / Duplicate Webhook Handling...');
    const duplicateRes = await axios.post(`${baseURL}/webhook/whatsapp`, samplePayload);
    console.log('Result 6: Duplicate Webhook Result =', duplicateRes.data);

    console.log('\n All 6 test suites passed successfully!');
  } catch (err) {
    console.error('Test Failed:', err.response ? err.response.data : err.message);
    process.exitCode = 1;
  } finally {
    await app.close();
    console.log('Test server closed cleanly.');
  }
}

runTests();
