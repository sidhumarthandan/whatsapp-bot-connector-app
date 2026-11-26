import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { GroupsService } from '../groups/groups.service';
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
    if (messageText === '1') {
      selectedMenu = 'MENU_1';
    } else if (messageText === '2') {
      selectedMenu = 'MENU_2';
    }

    if (!selectedMenu) {
      this.logger.warn(
        `Invalid or non-menu response from ${userPhone} in group ${groupId}: "${messageText}"`,
      );
      return;
    }

    this.logger.log('========== GROUP INTERACTION ==========');
    this.logger.log(`Group ID : ${groupId}`);
    this.logger.log(`User     : ${userPhone}`);
    this.logger.log(`Menu     : ${selectedMenu}`);
    this.logger.log(`Msg ID   : ${messageId}`);
    this.logger.log('=======================================');

    // Maintain in-memory dummy group, participant, and interaction history
    await this.groupsService.upsertGroup(groupId);
    await this.groupsService.upsertParticipant(groupId, userPhone);
    await this.groupsService.recordMenuInteraction(
      groupId,
      userPhone,
      selectedMenu,
      messageId,
    );

    // Send automatic reply back to group
    let replyText = '';
    if (selectedMenu === 'MENU_1') {
      replyText = 'You selected Menu 1. Thank you!';
    } else if (selectedMenu === 'MENU_2') {
      replyText = 'You selected Menu 2. Thank you!';
    }

    if (replyText) {
      try {
        await this.sendGroupMessage(groupId, replyText, phoneNumberId);
      } catch (error) {
        this.logger.warn(
          `Auto-reply attempt logged for group ${groupId}: ${error.message}`,
        );
      }
    }

    // Forward event to Make.com webhook if configured
    await this.notifyMakeWebhook({
      event: 'WHATSAPP_MENU_SELECTED',
      groupId,
      userId: userPhone,
      menuId: selectedMenu,
      messageId,
      timestamp: new Date().toISOString(),
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
