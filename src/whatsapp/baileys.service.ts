import { Injectable, OnModuleInit, Logger, Inject, forwardRef } from '@nestjs/common';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
} from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import * as QRCodeImage from 'qrcode';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';
import { GroupsService } from '../groups/groups.service';

@Injectable()
export class BaileysService implements OnModuleInit {
  private readonly logger = new Logger('WhatsApp-Web-Bot');
  public sock: WASocket | null = null;
  public isConnected = false;
  public latestQr: string | null = null;
  public qrDataUrl: string | null = null;

  // Track messages sent by bot to prevent any loop
  private readonly botSentMessageIds = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    private readonly groupsService: GroupsService,
  ) {}

  async onModuleInit() {
    // Start Baileys connection on application startup
    this.connectToWhatsApp().catch((err) => {
      this.logger.error(`Failed to initialize WhatsApp Web socket: ${err.message}`);
    });
  }

  async connectToWhatsApp() {
    const authPath = path.join(process.cwd(), 'auth_info_baileys');
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false, // We use custom qrcode-terminal for clear rendering
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.latestQr = qr;
        try {
          this.qrDataUrl = await QRCodeImage.toDataURL(qr, { scale: 8, margin: 2 });
        } catch (err) {
          this.logger.error(`Failed to generate QR data URL: ${err.message}`);
        }

        console.log('\n=============================================================');
        console.log('📲 WHATSAPP QR CODE READY FOR SCANNING:');
        console.log('👉 If terminal QR is distorted, OPEN IN BROWSER TO SCAN EASILY:');
        console.log('👉 http://localhost:3000/qr');
        console.log('=============================================================\n');
        qrcode.generate(qr, { small: true });
        console.log('\n=============================================================\n');
      }

      if (connection === 'close') {
        this.isConnected = false;
        this.latestQr = null;
        this.qrDataUrl = null;
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        this.logger.warn(
          `WhatsApp Web connection closed (Status: ${statusCode}). Logged out: ${isLoggedOut}`,
        );

        if (isLoggedOut) {
          this.logger.log('User logged out from WhatsApp. Auto-clearing session and generating fresh QR code...');
          try {
            fs.rmSync(authPath, { recursive: true, force: true });
          } catch (e) {}
          setTimeout(() => this.connectToWhatsApp(), 1500);
        } else {
          // Reconnect after network drop or temporary disconnect
          setTimeout(() => this.connectToWhatsApp(), 3000);
        }
      } else if (connection === 'open') {
        this.isConnected = true;
        this.logger.log('🎉 WHATSAPP BOT CONNECTED SUCCESSFULLY VIA WHATSAPP WEB!');
        this.logger.log('🤖 Ready to listen to queries in your WhatsApp Groups!');
      }
    });

    // Listen to incoming real WhatsApp messages
    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of messages) {
        if (!msg.message) continue;

        const messageId = msg.key.id || '';

        // 1. Ignore messages that the BOT ITSELF sent programmatically (prevents loops)
        if (this.botSentMessageIds.has(messageId)) {
          continue;
        }

        // Robust message text extraction
        const messageText = (
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.ephemeralMessage?.message?.conversation ||
          msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
          ''
        ).trim();

        if (!messageText) continue;

        const remoteJid = msg.key.remoteJid || '';
        const isGroup = remoteJid.endsWith('@g.us');
        const senderJid = msg.key.participant || remoteJid;
        const userPhone = senderJid.replace('@s.whatsapp.net', '').replace('@g.us', '');

        const normalizedText = messageText.toLowerCase();

        // Fetch Real Group Details if it is a group
        let groupName = isGroup ? 'WhatsApp Group' : 'Direct Personal Chat';
        let totalParticipants = 1;
        let groupDesc = '';

        if (isGroup && this.sock) {
          try {
            const groupMeta = await this.sock.groupMetadata(remoteJid);
            groupName = groupMeta.subject || groupName;
            totalParticipants = groupMeta.participants?.length || 1;
            groupDesc = groupMeta.desc?.toString() || '';
          } catch (err) {
            groupName = `Group (${remoteJid.slice(0, 15)}...)`;
          }
        }

        // Privacy Whitelist: Only process groups configured in ALLOWED_GROUPS (.env)
        const rawAllowedGroups = this.configService.get<string>('ALLOWED_GROUPS');
        if (rawAllowedGroups && rawAllowedGroups.trim().length > 0) {
          const allowedList = rawAllowedGroups
            .split(',')
            .map((g) => g.trim().toLowerCase())
            .filter((g) => g.length > 0);

          const isAllowed = isGroup && allowedList.some(
            (allowed) =>
              groupName.toLowerCase().includes(allowed) ||
              allowed.includes(groupName.toLowerCase()) ||
              remoteJid.toLowerCase() === allowed,
          );

          if (!isAllowed) {
            // Strictly ignore personal messages and unapproved groups for privacy!
            continue;
          }
        }

        // 2. Greeting / Menu request: user must explicitly say hi / hello / menu
        if (
          normalizedText === 'hi' ||
          normalizedText === 'hello' ||
          normalizedText === 'menu' ||
          normalizedText === 'start' ||
          normalizedText === '!menu'
        ) {
          console.log('\n====================================================');
          console.log('👋 USER REQUESTED MENU');
          console.log(`👥 Group Name  : ${groupName}`);
          console.log(`📌 Group ID    : ${remoteJid}`);
          console.log(`👤 User Phone  : +${userPhone}`);
          console.log(`💬 Message     : "${messageText}"`);
          console.log('====================================================');

          const menuPrompt =
            `👋 *Welcome to Account Services Bot!*\n` +
            `📍 *Group:* ${groupName}\n\n` +
            `Please select an option by replying with *1* or *2*:\n` +
            `1️⃣ *1. Closing statement*\n` +
            `2️⃣ *2. Check balance*\n\n` +
            `_Reply with 1 or 2._`;

          try {
            const sent = await this.sock.sendMessage(remoteJid, { text: menuPrompt });
            if (sent?.key?.id) this.botSentMessageIds.add(sent.key.id);
            console.log(`✅ [BOT SENT MENU] Posted menu into "${groupName}"`);
          } catch (err) {
            this.logger.error(`Failed to send menu: ${err.message}`);
          }
          continue;
        }

        // 3. Exact user selection: User must reply "1" (or "closing statement") or "2" (or "check balance")
        let selectedMenu = '';
        let optionNumber = '';

        if (
          normalizedText === '1' ||
          normalizedText === 'closing statement' ||
          normalizedText === 'clossing statement' ||
          normalizedText === '1. closing statement'
        ) {
          selectedMenu = 'CLOSING_STATEMENT';
          optionNumber = '1. Closing statement';
        } else if (
          normalizedText === '2' ||
          normalizedText === 'check balance' ||
          normalizedText === 'balance' ||
          normalizedText === '2. check balance'
        ) {
          selectedMenu = 'CHECK_BALANCE';
          optionNumber = '2. Check balance';
        }

        // If not a recognized option, do not reply automatically
        if (!selectedMenu) {
          continue;
        }

        console.log('\n====================================================');
        console.log('📢 USER SELECTED OPTION IN WHATSAPP GROUP!');
        console.log(`👥 Group Name   : ${groupName}`);
        console.log(`📌 Group ID     : ${remoteJid}`);
        console.log(`👤 User Phone   : +${userPhone}`);
        console.log(`🔢 User Typed   : "${messageText}"`);
        console.log(`📄 Option Chosen: ${optionNumber}`);
        console.log('====================================================');

        // Maintain in-memory dummy group, participant, and interaction history
        await this.groupsService.upsertGroup(remoteJid, groupName);
        await this.groupsService.upsertParticipant(remoteJid, userPhone);
        await this.groupsService.recordMenuInteraction(
          remoteJid,
          userPhone,
          selectedMenu,
          messageId,
        );

        // Clean Output Data requested for this interaction
        const interactionData = {
          groupName,
          groupId: remoteJid,
          totalParticipants,
          groupDescription: groupDesc || undefined,
          userPhone: `+${userPhone}`,
          selectedOption: optionNumber,
          timestamp: new Date().toISOString(),
        };

        console.log(`📊 [CONSOLE DATA] Interaction Recorded:`);
        console.log(JSON.stringify(interactionData, null, 2));

        // Short & clean confirmation message back to WhatsApp Group
        const replyText =
          `✅ *Option Recorded!*\n` +
          `• *Group:* ${groupName}\n` +
          `• *User:* +${userPhone}\n` +
          `• *Selected Option:* ${optionNumber}`;

        // Send confirmation back into WhatsApp group
        try {
          const sent = await this.sock.sendMessage(remoteJid, { text: replyText });
          if (sent?.key?.id) this.botSentMessageIds.add(sent.key.id);
          console.log(`✅ [BOT CONFIRMED] Sent confirmation into "${groupName}"`);
        } catch (err) {
          this.logger.error(`Failed to send message: ${err.message}`);
        }

        // Forward clean event to Make.com Webhook
        await this.whatsappService.notifyMakeWebhook({
          event: 'GROUP_OPTION_SELECTED',
          groupId: remoteJid,
          userId: userPhone,
          menuId: selectedMenu,
          option: optionNumber,
          messageId,
          timestamp: new Date().toISOString(),
          extra: interactionData,
        });
      }
    });
  }

  /**
   * Helper method to send messages to groups or users through Baileys
   */
  async sendTextMessage(toJid: string, text: string) {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp Web client is not connected yet.');
    }
    return this.sock.sendMessage(toJid, { text });
  }

  /**
   * Reset session and generate fresh QR code immediately
   */
  async resetSession() {
    this.isConnected = false;
    this.latestQr = null;
    this.qrDataUrl = null;
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch (e) {}
    }
    const authPath = path.join(process.cwd(), 'auth_info_baileys');
    try {
      fs.rmSync(authPath, { recursive: true, force: true });
    } catch (e) {}
    this.logger.log('WhatsApp session cleared. Re-generating fresh QR code...');
    await this.connectToWhatsApp();
  }
}
