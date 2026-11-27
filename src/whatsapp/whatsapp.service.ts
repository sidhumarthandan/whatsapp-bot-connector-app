import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { GroupsService } from '../groups/groups.service';
import { BaileysService } from './baileys.service';
import {
  WhatsAppIncomingMessage,
  WhatsAppWebhookPayload,
  MakeWebhookPayload,
  SendMessageResponse,
} from './whatsapp.types';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  // In-memory set to ensure idempotency within process runtime
  private readonly processedMessageIds = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly groupsService: GroupsService,
    @Inject(forwardRef(() => BaileysService))
    private readonly baileysService: BaileysService,
  ) {}

  /**
   * Main webhook entry point for processing incoming Meta WhatsApp events
   */
  async processWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    const entries = payload.entry || [];

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value) continue;

        // Process incoming messages
        for (const message of value.messages || []) {
          await this.processIncomingMessage(message, value.metadata?.phone_number_id);
        }

        // Process delivery/read statuses if present
        for (const status of value.statuses || []) {
          this.logger.debug(
            `Message status update: ID=${status.id}, Status=${status.status}, Recipient=${status.recipient_id}`,
          );
        }
      }
    }
  }

  /**
   * Processes a single incoming message from a WhatsApp group or user
   */
  async processIncomingMessage(
    message: WhatsAppIncomingMessage,
    phoneNumberId?: string,
  ): Promise<void> {
    const messageId = message.id;

    // Idempotency check: prevent duplicate event processing
    if (this.processedMessageIds.has(messageId)) {
      this.logger.warn(`Duplicate message received and ignored: ${messageId}`);
      return;
    }
    this.processedMessageIds.add(messageId);

    // Keep memory cache bounded
    if (this.processedMessageIds.size > 5000) {
      const firstItem = this.processedMessageIds.values().next().value;
      if (firstItem) this.processedMessageIds.delete(firstItem);
    }

    const groupId = message.group_id || message.context?.group_id;
    const userPhone = message.from;
    const messageText = message.text?.body?.trim();

    if (!groupId) {
      this.logger.log(`Individual message received from ${userPhone}: "${messageText}"`);
      return;
    }

    let selectedMenu = '';
    const normalizedText = messageText?.toLowerCase() || '';

    if (
      normalizedText === '1' ||
      normalizedText.includes('closing') ||
      normalizedText.includes('clossing')
    ) {
      selectedMenu = 'CLOSING_STATEMENT';
    } else if (
      normalizedText === '2' ||
      normalizedText.includes('unsettled')
    ) {
      selectedMenu = 'UNSETTLED_STATEMENT';
    }

    if (!selectedMenu) {
      this.logger.warn(
        `Invalid query response from ${userPhone} in group ${groupId}: "${messageText}"`,
      );
      return;
    }

    this.logger.log('====================================================');
    this.logger.log('📢 NEW WHATSAPP GROUP QUERY DETECTED');
    this.logger.log(`📌 Group ID    : ${groupId}`);
    this.logger.log(`👤 User Phone  : ${userPhone}`);
    this.logger.log(`📄 Query Type  : ${selectedMenu}`);
    this.logger.log(`🆔 Message ID  : ${messageId}`);
    this.logger.log('====================================================');

    // Maintain in-memory dummy group, participant, and interaction history
    await this.groupsService.upsertGroup(groupId);
    await this.groupsService.upsertParticipant(groupId, userPhone);
    await this.groupsService.recordMenuInteraction(
      groupId,
      userPhone,
      selectedMenu,
      messageId,
    );

    // Dummy JSON Statements Data
    const dummyStatements = {
      CLOSING_STATEMENT: {
        statementType: 'Closing Statement',
        accountNumber: 'ACC-8839201',
        period: 'November 2026',
        totalInvoiced: '₹1,50,000',
        totalSettled: '₹1,50,000',
        closingBalance: '₹0.00',
        status: 'FULLY_CLOSED',
        generatedAt: new Date().toISOString(),
      },
      UNSETTLED_STATEMENT: {
        statementType: 'Unsettled Statement',
        accountNumber: 'ACC-8839201',
        period: 'November 2026',
        pendingInvoicesCount: 3,
        unsettledAmount: '₹42,350',
        nextDueDate: '05-Dec-2026',
        status: 'PENDING_SETTLEMENT',
        generatedAt: new Date().toISOString(),
      },
    };

    const statementData = dummyStatements[selectedMenu];
    this.logger.log(`📊 Generated Dummy JSON Response for ${selectedMenu}:`);
    this.logger.log(JSON.stringify(statementData, null, 2));

    // Format human-friendly WhatsApp message
    let replyText = '';
    if (selectedMenu === 'CLOSING_STATEMENT') {
      replyText =
        `📄 *Closing Statement Details*\n` +
        `• Account: ${statementData.accountNumber}\n` +
        `• Period: ${statementData.period}\n` +
        `• Total Settled: ${statementData.totalSettled}\n` +
        `• Closing Balance: ${statementData.closingBalance}\n` +
        `• Status: ✅ ${statementData.status}`;
    } else {
      replyText =
        `⚠️ *Unsettled Statement Details*\n` +
        `• Account: ${statementData.accountNumber}\n` +
        `• Pending Invoices: ${statementData.pendingInvoicesCount}\n` +
        `• Unsettled Amount: ${statementData.unsettledAmount}\n` +
        `• Due Date: ${statementData.nextDueDate}\n` +
        `• Status: ⏳ ${statementData.status}`;
    }

    // Auto-reply to WhatsApp group with statement details
    try {
      await this.sendGroupMessage(groupId, replyText, phoneNumberId);
    } catch (error) {
      this.logger.warn(
        `Auto-reply attempt logged for group ${groupId}: ${error.message}`,
      );
    }

    // Forward event + dummy JSON statement to Make.com Webhook
    await this.notifyMakeWebhook({
      event: 'WHATSAPP_STATEMENT_REQUESTED',
      groupId,
      userId: userPhone,
      menuId: selectedMenu,
      messageId,
      timestamp: new Date().toISOString(),
      extra: {
        statementData,
      },
    });
  }

  /**
   * Sends a message dynamically to a target WhatsApp group using Meta Graph API
   */
  async sendGroupMessage(
    groupId: string,
    message: string,
    overridePhoneNumberId?: string,
  ): Promise<SendMessageResponse | any> {
    // If Baileys is connected and destination is a WhatsApp Web group JID
    if (groupId.endsWith('@g.us') && this.baileysService?.isConnected) {
      try {
        const sendResult = await this.baileysService.sendTextMessage(groupId, message);
        this.logger.log(`Message sent directly via WhatsApp Web to group: ${groupId}`);
        return {
          platform: 'whatsapp_web_baileys',
          sentToGroup: groupId,
          messageId: sendResult?.key?.id,
          success: true,
        };
      } catch (err) {
        this.logger.error(`Error sending via Baileys to ${groupId}: ${err.message}`);
      }
    }

    const phoneNumberId =
      overridePhoneNumberId ||
      this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.configService.get<string>('META_ACCESS_TOKEN');
    const apiVersion = this.configService.get<string>('META_API_VERSION') || 'v21.0';

    // If using dummy test credentials, mock the successful dispatch directly
    if (
      !accessToken ||
      accessToken === 'test_access_token' ||
      accessToken === 'YOUR_ACCESS_TOKEN'
    ) {
      const mockResult = {
        messaging_product: 'whatsapp',
        contacts: [{ input: groupId, wa_id: groupId }],
        messages: [{ id: `wamid.MOCK_${Date.now()}` }],
        mock: true,
        sentToGroup: groupId,
        messageBody: message,
      };
      this.logger.log(
        `[MOCK DISPATCH] Message sent to group ${groupId}: "${message}"`,
      );
      return mockResult;
    }

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'group',
      to: groupId,
      type: 'text',
      text: { body: message },
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<SendMessageResponse>(url, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(`Message successfully sent to Meta API for group: ${groupId}`);
      return response.data;
    } catch (error) {
      const errorData = error.response?.data || error.message;
      this.logger.error(
        `Meta Graph API send message error for group ${groupId}: ${JSON.stringify(errorData)}`,
      );
      throw error;
    }
  }

  /**
   * Forwards normalized interaction events to Make.com webhook if configured
   */
  async notifyMakeWebhook(eventData: MakeWebhookPayload): Promise<void> {
    const makeWebhookUrl = this.configService.get<string>('MAKE_WEBHOOK_URL');
    if (!makeWebhookUrl) {
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(makeWebhookUrl, eventData, {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      this.logger.log(`Forwarded interaction event to Make.com: ${eventData.menuId}`);
    } catch (error) {
      this.logger.warn(
        `Failed to forward event to Make.com: ${error.response?.data || error.message}`,
      );
    }
  }
}
