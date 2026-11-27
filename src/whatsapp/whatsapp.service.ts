import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { GroupsService } from '../groups/groups.service';
import {
  WhatsAppIncomingMessage,
  WhatsAppWebhookPayload,
  WahaWebhookPayload,
  MakeWebhookPayload,
  SendMessageResponse,
  StatementMenuId,
  StatementData,
  GroupMemberSummary,
  GroupQueryResponsePayload,
} from './whatsapp.types';

const MENU_PROMPT_TEXT = [
  'Welcome! Please choose an option:',
  '1. Closing statement',
  '2. Unsettled statement',
  'Reply with 1 or 2 (or type the option name).',
].join('\n');

const MENU_TRIGGER_WORDS = new Set([
  'hi',
  'hello',
  'menu',
  'start',
  'options',
  'help',
]);

const MENU_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  // In-memory set to ensure idempotency within process runtime
  private readonly processedMessageIds = new Set<string>();
  // Tracks groups where the bot menu was explicitly opened (groupId -> expiry timestamp)
  private readonly activeGroupMenus = new Map<string, number>();

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

        for (const message of value.messages || []) {
          await this.processIncomingMessage(message, value.metadata?.phone_number_id);
        }

        for (const status of value.statuses || []) {
          this.logger.debug(
            `Message status update: ID=${status.id}, Status=${status.status}, Recipient=${status.recipient_id}`,
          );
        }
      }
    }
  }

  /**
   * Webhook entry point for WAHA (WhatsApp HTTP API) events
   */
  async processWahaWebhook(payload: WahaWebhookPayload): Promise<void> {
    if (!payload || (payload.event !== 'message' && payload.event !== 'message.any')) {
      return;
    }

    const msg = payload.payload;
    if (!msg || msg.fromMe) {
      return;
    }

    const chatId = msg.from || msg.chatId || '';
    const isGroup = chatId.endsWith('@g.us');
    if (!isGroup) {
      this.logger.log(`WAHA individual message received from ${chatId}: "${msg.body || ''}"`);
      return;
    }

    const rawParticipant =
      msg.participant || msg._data?.key?.participant || msg.from || 'unknown';
    const userName = msg._data?.pushName || msg._data?.notifyName || msg.notifyName;

    await this.handleNormalizedGroupMessage({
      groupId: chatId,
      rawParticipant,
      userName,
      userPhone: rawParticipant.replace(/@(c\.us|s\.whatsapp\.net|lid)$/i, ''),
      messageText: (msg.body || '').trim(),
      messageId: msg.id || `waha_${Date.now()}`,
    });
  }

  /**
   * Processes a single incoming message from a Meta WhatsApp webhook
   */
  async processIncomingMessage(
    message: WhatsAppIncomingMessage,
    phoneNumberId?: string,
  ): Promise<void> {
    const groupId = message.group_id || message.context?.group_id;
    const userPhone = message.from;
    const messageText = (message.text?.body || '').trim();

    if (!groupId) {
      this.logger.log(`Individual message received from ${userPhone}: "${messageText}"`);
      return;
    }

    await this.handleNormalizedGroupMessage({
      groupId,
      userPhone,
      messageText,
      messageId: message.id,
      phoneNumberId,
    });
  }

  /**
   * Shared handler for normalized group messages from Meta or WAHA
   */
  private async handleNormalizedGroupMessage(params: {
    groupId: string;
    userPhone: string;
    rawParticipant?: string;
    userName?: string;
    messageText: string;
    messageId: string;
    phoneNumberId?: string;
  }): Promise<void> {
    const {
      groupId,
      rawParticipant,
      userName,
      messageText,
      messageId,
      phoneNumberId,
    } = params;
    let userPhone = params.userPhone;

    if (this.processedMessageIds.has(messageId)) {
      this.logger.warn(`Duplicate message received and ignored: ${messageId}`);
      return;
    }
    this.processedMessageIds.add(messageId);

    if (this.processedMessageIds.size > 5000) {
      const firstItem = this.processedMessageIds.values().next().value;
      if (firstItem) this.processedMessageIds.delete(firstItem);
    }

    const normalized = messageText.toLowerCase();

    if (MENU_TRIGGER_WORDS.has(normalized)) {
      this.logger.log(`Menu prompt requested by ${userPhone} in group ${groupId}`);
      this.activeGroupMenus.set(groupId, Date.now() + MENU_SESSION_TTL_MS);
      await this.groupsService.upsertGroup(groupId);
      await this.groupsService.upsertParticipant(groupId, userPhone);
      await this.safeSendGroupMessage(groupId, MENU_PROMPT_TEXT, phoneNumberId);
      return;
    }

    const selectedMenu = this.parseMenuSelection(normalized);
    if (!selectedMenu) {
      this.logger.debug(
        `Non-menu message from ${userPhone} in group ${groupId}: "${messageText}"`,
      );
      return;
    }

    if (!this.consumeActiveMenu(groupId)) {
      this.logger.debug(
        `Ignored "${messageText}" in group ${groupId} — menu not active (send "menu" or "hi" first).`,
      );
      return;
    }

    const statementData = this.buildDummyStatementData(selectedMenu);
    const wahaMeta = groupId.endsWith('@g.us')
      ? await this.fetchWahaGroupMetadata(groupId, rawParticipant, userName)
      : null;

    if (wahaMeta?.resolvedPhone) {
      userPhone = wahaMeta.resolvedPhone;
    }

    const existingGroup = await this.groupsService.upsertGroup(
      groupId,
      wahaMeta?.groupName,
    );
    await this.groupsService.upsertParticipant(groupId, userPhone);
    await this.groupsService.recordMenuInteraction(
      groupId,
      userPhone,
      selectedMenu,
      messageId,
    );

    const groupName = wahaMeta?.groupName || existingGroup.groupName || groupId;
    const totalParticipants =
      wahaMeta?.totalMembers ?? existingGroup.participants.length;
    const formattedUserPhone = userPhone.startsWith('+')
      ? userPhone
      : `+${userPhone}`;
    const selectedOptionLabel =
      selectedMenu === 'CLOSING_STATEMENT'
        ? '1. Closing statement'
        : '2. Unsettled statement';

    const membersList: GroupMemberSummary[] =
      wahaMeta?.membersList ||
      existingGroup.participants.map((p) => ({
        name:
          p.whatsappUserId === userPhone && userName
            ? userName
            : 'WhatsApp Member',
        phone: p.whatsappUserId.startsWith('+')
          ? p.whatsappUserId
          : `+${p.whatsappUserId}`,
        role: 'Member',
      }));

    const structuredResponse: GroupQueryResponsePayload = {
      groupDetails: {
        groupName,
        groupId,
        groupBio: wahaMeta?.groupBio || 'No description',
        createdAt:
          wahaMeta?.createdAt ||
          existingGroup.createdAt.toLocaleString('en-GB', { hour12: true }),
        createdBy: wahaMeta?.createdBy || formattedUserPhone,
        totalParticipants,
        membersList,
      },
      userDetails: {
        name: userName || 'WhatsApp Member',
        phone: formattedUserPhone,
      },
      selectedOption: selectedOptionLabel,
      statementResponse: statementData,
      timestamp: new Date().toISOString(),
    };

    const statementApiResponse = {
      success: true,
      queryType: selectedMenu,
      senderName: userName || 'WhatsApp Member',
      senderPhone: formattedUserPhone,
      groupId,
      groupName,
      data: statementData,
    };

    this.logger.log('====================================================');
    this.logger.log('📢 NEW WHATSAPP GROUP QUERY DETECTED');
    this.logger.log(`📌 Group     : ${groupName} (${groupId})`);
    this.logger.log(`👤 Sender    : ${userName || 'WhatsApp Member'} (${formattedUserPhone})`);
    this.logger.log(`📄 Query Type: ${selectedMenu}`);
    this.logger.log(`🆔 Message ID: ${messageId}`);
    this.logger.log('====================================================');
    this.logger.log(
      `📊 Statement API Response (${selectedMenu}):\n${JSON.stringify(statementApiResponse, null, 2)}`,
    );

    const autoReplyEnabled =
      this.configService.get<string>('AUTO_REPLY_FROM_NESTJS') !== 'false';
    if (autoReplyEnabled) {
      const replyText = this.formatStatementReply(statementApiResponse);
      await this.safeSendGroupMessage(groupId, replyText, phoneNumberId);
    }

    await this.notifyMakeWebhook({
      event: 'WHATSAPP_MENU_SELECTED',
      groupId,
      userId: userPhone,
      menuId: selectedMenu,
      messageId,
      timestamp: structuredResponse.timestamp,
      extra: {
        ...structuredResponse,
        statementApiResponse,
      },
    });
  }

  private consumeActiveMenu(groupId: string): boolean {
    const expiresAt = this.activeGroupMenus.get(groupId);
    if (!expiresAt) {
      return false;
    }
    this.activeGroupMenus.delete(groupId);
    return Date.now() <= expiresAt;
  }

  private parseMenuSelection(normalizedText: string): StatementMenuId | null {
    if (
      normalizedText === '1' ||
      normalizedText === 'closing' ||
      normalizedText === 'closing statement' ||
      normalizedText === '1. closing statement'
    ) {
      return 'CLOSING_STATEMENT';
    }

    if (
      normalizedText === '2' ||
      normalizedText === 'unsettled' ||
      normalizedText === 'unsettled statement' ||
      normalizedText === '2. unsettled statement'
    ) {
      return 'UNSETTLED_STATEMENT';
    }

    return null;
  }

  async getGroupDetailsForApi(groupId?: string) {
    if (groupId && groupId.endsWith('@g.us')) {
      const wahaMeta = await this.fetchWahaGroupMetadata(groupId);
      if (wahaMeta) {
        return {
          groupName: wahaMeta.groupName || groupId,
          groupId,
          groupBio: wahaMeta.groupBio || 'No description',
          createdAt: wahaMeta.createdAt || new Date().toLocaleString('en-GB', { hour12: true }),
          createdBy: wahaMeta.createdBy || 'Unknown',
          totalParticipants: wahaMeta.totalMembers ?? (wahaMeta.membersList?.length || 0),
          membersList: wahaMeta.membersList || [],
        };
      }
    }

    if (groupId) {
      const existing = await this.groupsService.getGroupDetails(groupId);
      if (existing) {
        return {
          groupName: existing.groupName || existing.whatsappGroupId,
          groupId: existing.whatsappGroupId,
          groupBio: 'No description',
          createdAt: existing.createdAt.toLocaleString('en-GB', { hour12: true }),
          createdBy: existing.participants[0]
            ? `+${existing.participants[0].whatsappUserId.replace(/^\+/, '')}`
            : 'Unknown',
          totalParticipants: existing.participants.length,
          membersList: existing.participants.map((p) => ({
            name: 'WhatsApp Member',
            phone: `+${p.whatsappUserId.replace(/^\+/, '')}`,
            role: 'Member' as const,
          })),
        };
      }
    }

    return null;
  }

  getStatementData(
    menuId: StatementMenuId,
    groupId?: string,
  ): StatementData & { groupId?: string } {
    const data = this.buildDummyStatementData(menuId);
    return groupId ? { groupId, ...data } : data;
  }

  private buildDummyStatementData(menuId: StatementMenuId): StatementData {
    const generatedAt = new Date().toISOString();

    if (menuId === 'CLOSING_STATEMENT') {
      return {
        statementType: 'Closing Statement',
        accountNumber: 'ACC-8839201',
        period: 'November 2026',
        totalInvoiced: '₹1,50,000',
        totalSettled: '₹1,50,000',
        closingBalance: '₹0.00',
        status: 'FULLY_CLOSED',
        generatedAt,
      };
    }

    return {
      statementType: 'Unsettled Statement',
      accountNumber: 'ACC-8839201',
      period: 'November 2026',
      pendingInvoicesCount: 3,
      unsettledAmount: '₹42,350',
      nextDueDate: '05-Dec-2026',
      status: 'PENDING_SETTLEMENT',
      generatedAt,
    };
  }

  private formatStatementReply(responsePayload: {
    success: boolean;
    queryType: StatementMenuId;
    senderName: string;
    senderPhone: string;
    groupId: string;
    groupName: string;
    data: StatementData;
  }): string {
    return [
      '✅ *Option Recorded!*',
      `• *Group:* ${responsePayload.groupName}`,
      `• *User:* ${responsePayload.senderName} (${responsePayload.senderPhone})`,
      `• *Query Type:* ${responsePayload.queryType}`,
      '',
      '```',
      JSON.stringify(responsePayload, null, 2),
      '```',
    ].join('\n');
  }

  private async fetchWahaGroupMetadata(
    groupId: string,
    rawParticipant?: string,
    senderName?: string,
  ): Promise<{
    groupName?: string;
    groupBio?: string;
    createdAt?: string;
    createdBy?: string;
    totalMembers?: number;
    resolvedPhone?: string;
    membersList?: GroupMemberSummary[];
  } | null> {
    const wahaBaseUrl = this.configService.get<string>('WAHA_BASE_URL');
    if (!wahaBaseUrl) return null;

    const apiKey = this.configService.get<string>('WAHA_API_KEY') || '';
    const session = this.configService.get<string>('WAHA_SESSION') || 'default';
    const url = `${wahaBaseUrl.replace(/\/$/, '')}/api/${session}/groups/${encodeURIComponent(groupId)}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: apiKey ? { 'X-Api-Key': apiKey } : undefined,
          timeout: 3000,
        }),
      );
      const group = response.data;
      const participants: Array<{
        id?: string;
        phoneNumber?: string;
        admin?: string | null;
        notify?: string;
        name?: string;
      }> = group?.participants || [];

      let resolvedPhone: string | undefined;
      if (rawParticipant) {
        const match = participants.find((p) => p.id === rawParticipant);
        if (match?.phoneNumber) {
          resolvedPhone = match.phoneNumber.replace(
            /@(c\.us|s\.whatsapp\.net|lid)$/i,
            '',
          );
        }
      }

      const membersList: GroupMemberSummary[] = participants.map((p) => {
        const rawPhone = (p.phoneNumber || p.id || '').replace(
          /@(c\.us|s\.whatsapp\.net|lid)$/i,
          '',
        );
        const role: GroupMemberSummary['role'] =
          p.admin === 'superadmin'
            ? 'Super Admin'
            : p.admin === 'admin'
              ? 'Admin'
              : 'Member';
        const isSender = rawParticipant && p.id === rawParticipant;
        return {
          name: (isSender && senderName) || p.notify || p.name || 'WhatsApp Member',
          phone: rawPhone ? `+${rawPhone.replace(/^\+/, '')}` : 'Unknown',
          role,
        };
      });

      const rawCreator = (group?.ownerPn || group?.owner || '').replace(
        /@(c\.us|s\.whatsapp\.net|lid)$/i,
        '',
      );

      return {
        groupName: group?.subject,
        groupBio: group?.desc || 'No description',
        createdAt: group?.creation
          ? new Date(group.creation * 1000).toLocaleString('en-GB', {
              hour12: true,
            })
          : undefined,
        createdBy: rawCreator ? `+${rawCreator.replace(/^\+/, '')}` : undefined,
        totalMembers: group?.size ?? (participants.length || undefined),
        resolvedPhone,
        membersList,
      };
    } catch {
      return null;
    }
  }

  private async safeSendGroupMessage(
    groupId: string,
    message: string,
    phoneNumberId?: string,
  ): Promise<void> {
    try {
      await this.sendGroupMessage(groupId, message, phoneNumberId);
    } catch (error) {
      this.logger.warn(
        `Auto-reply attempt logged for group ${groupId}: ${error.message}`,
      );
    }
  }

  /**
   * Sends a message dynamically to a target WhatsApp group via WAHA, Meta Graph API, or mock
   */
  async sendGroupMessage(
    groupId: string,
    message: string,
    overridePhoneNumberId?: string,
  ): Promise<SendMessageResponse | any> {
    const wahaBaseUrl = this.configService.get<string>('WAHA_BASE_URL');
    if (wahaBaseUrl && groupId.includes('@')) {
      return this.sendViaWaha(wahaBaseUrl, groupId, message);
    }

    const phoneNumberId =
      overridePhoneNumberId ||
      this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.configService.get<string>('META_ACCESS_TOKEN');
    const apiVersion = this.configService.get<string>('META_API_VERSION') || 'v21.0';

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
        `[MOCK DISPATCH] Message sent to group ${groupId}:\n${message}`,
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

  private async sendViaWaha(
    wahaBaseUrl: string,
    chatId: string,
    text: string,
  ): Promise<any> {
    const apiKey = this.configService.get<string>('WAHA_API_KEY') || '';
    const session = this.configService.get<string>('WAHA_SESSION') || 'default';
    const url = `${wahaBaseUrl.replace(/\/$/, '')}/api/sendText`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['X-Api-Key'] = apiKey;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          url,
          { session, chatId, text },
          { headers },
        ),
      );
      this.logger.log(`Message sent via WAHA to group ${chatId}`);
      return response.data;
    } catch (error) {
      const errorData = error.response?.data || error.message;
      this.logger.error(
        `WAHA sendText error for group ${chatId}: ${JSON.stringify(errorData)}`,
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
