const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const axios = require('axios');
const { AppModule } = require('../dist/app.module');

function buildMetaPayload({ groupId, from, messageId, text }) {
  return {
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
                  from,
                  id: messageId,
                  timestamp: '1732626000',
                  type: 'text',
                  text: { body: text },
                  group_id: groupId,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

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

  await app.listen(3000, '127.0.0.1');
  const baseURL = 'http://127.0.0.1:3000';

  try {
    console.log('\n[TEST 1] Verifying Meta Webhook Challenge (GET /webhook/whatsapp)...');
    const verifyRes = await axios.get(`${baseURL}/webhook/whatsapp`, {
      params: {
        'hub.mode': 'subscribe',
        'hub.verify_token': process.env.META_VERIFY_TOKEN || 'test_verify_token',
        'hub.challenge': 'CHALLENGE_ACCEPTED_777',
      },
    });
    console.log('Result 1: Status =', verifyRes.status, ', Challenge =', verifyRes.data);

    console.log('\n[TEST 2] Querying In-Memory Dummy Groups (GET /groups)...');
    const groupsRes = await axios.get(`${baseURL}/groups`);
    console.log('Result 2: Total Groups =', groupsRes.data.total);

    console.log('\n[TEST 3] Simulating Closing Statement Query in Group A (POST /webhook/whatsapp)...');
    const closingPayload = buildMetaPayload({
      groupId: 'GROUP_ID_A',
      from: '919876543210',
      messageId: 'wamid.STMT_MSG_001',
      text: 'Closing statement',
    });
    const res3 = await axios.post(`${baseURL}/webhook/whatsapp`, closingPayload);
    console.log('Result 3:', res3.status, res3.data);

    console.log('\n[TEST 4] Simulating Unsettled Statement Query in Group B (POST /webhook/whatsapp)...');
    const unsettledPayload = buildMetaPayload({
      groupId: 'GROUP_ID_B',
      from: '919123456780',
      messageId: 'wamid.STMT_MSG_002',
      text: '2',
    });
    const res4 = await axios.post(`${baseURL}/webhook/whatsapp`, unsettledPayload);
    console.log('Result 4:', res4.status, res4.data);

    console.log('\n[TEST 5] Verifying Recorded Statement Interactions (GET /groups/GROUP_ID_A/interactions & GROUP_ID_B)...');
    const [intA, intB] = await Promise.all([
      axios.get(`${baseURL}/groups/GROUP_ID_A/interactions`),
      axios.get(`${baseURL}/groups/GROUP_ID_B/interactions`),
    ]);
    console.log('Result 5A (GROUP_ID_A):', intA.data.data.map((i) => i.menuId));
    console.log('Result 5B (GROUP_ID_B):', intB.data.data.map((i) => i.menuId));

    if (!intA.data.data.some((i) => i.menuId === 'CLOSING_STATEMENT')) {
      throw new Error('CLOSING_STATEMENT was not recorded for GROUP_ID_A');
    }
    if (!intB.data.data.some((i) => i.menuId === 'UNSETTLED_STATEMENT')) {
      throw new Error('UNSETTLED_STATEMENT was not recorded for GROUP_ID_B');
    }

    console.log('\n[TEST 6] Testing WAHA Group Webhook (@g.us) + Idempotency (POST /webhook/waha)...');
    const wahaPayload = {
      event: 'message',
      session: 'default',
      engine: 'NOWEB',
      payload: {
        id: 'waha_probe_msg_001',
        from: '120363000000000001@g.us',
        participant: '919876543210@c.us',
        body: '1',
        fromMe: false,
      },
    };
    const res6a = await axios.post(`${baseURL}/webhook/waha`, wahaPayload);
    const wahaGroupInt = await axios.get(`${baseURL}/groups/120363000000000001@g.us/interactions`);
    if (!wahaGroupInt.data.data.some((i) => i.menuId === 'CLOSING_STATEMENT')) {
      throw new Error('WAHA @g.us CLOSING_STATEMENT was not recorded');
    }
    const res6b = await axios.post(`${baseURL}/webhook/whatsapp`, closingPayload);
    console.log('Result 6: WAHA @g.us =', res6a.data, ', Duplicate Meta =', res6b.data);

    console.log('\n[TEST 7] Testing Statement Endpoints with Group Details (GET /statements/closing & /statements/unsettled)...');
    const [closingApi, unsettledApi] = await Promise.all([
      axios.get(`${baseURL}/statements/closing`, { params: { groupId: 'GROUP_ID_A' } }),
      axios.get(`${baseURL}/statements/unsettled`, { params: { groupId: 'GROUP_ID_B' } }),
    ]);
    if (closingApi.data?.data?.groupId !== 'GROUP_ID_A') {
      throw new Error('GET /statements/closing returned unexpected payload');
    }
    if (unsettledApi.data?.data?.groupId !== 'GROUP_ID_B') {
      throw new Error('GET /statements/unsettled returned unexpected payload');
    }
    console.log('Result 7A (Closing):', closingApi.data);
    console.log('Result 7B (Unsettled):', unsettledApi.data);

    console.log('\n✅ All 7 test scenarios passed successfully!');
  } catch (err) {
    console.error('Test Failed:', err.response ? err.response.data : err.message);
    process.exitCode = 1;
  } finally {
    await app.close();
    console.log('Test server closed cleanly.');
  }
}

runTests();
