export interface WhatsAppIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: {
    body: string;
  };
  group_id?: string;
  context?: {
    from?: string;
    id?: string;
    group_id?: string;
  };
}

export interface WhatsAppWebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: Array<{
    profile: {
      name: string;
    };
    wa_id: string;
  }>;
  messages?: WhatsAppIncomingMessage[];
  statuses?: Array<{
    id: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    timestamp: string;
    recipient_id: string;
    group_id?: string;
    errors?: Array<{
      code: number;
      title: string;
      message: string;
    }>;
  }>;
  group_metadata?: {
    group_id: string;
    group_name: string;
    creator?: string;
    creation_timestamp?: string;
  };
}

export interface WhatsAppWebhookChange {
  field: string;
  value: WhatsAppWebhookValue;
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppWebhookEntry[];
}

export interface WahaMessagePayload {
  id: string;
  timestamp?: number;
  from: string;
  to?: string;
  chatId?: string;
  participant?: string;
  body?: string;
  fromMe?: boolean;
  notifyName?: string;
  _data?: {
    pushName?: string;
    notifyName?: string;
    key?: {
      participant?: string;
      remoteJid?: string;
    };
  };
}

export interface WahaWebhookPayload {
  event: string;
  session?: string;
  engine?: string;
  payload?: WahaMessagePayload;
}

export type StatementMenuId = 'CLOSING_STATEMENT' | 'UNSETTLED_STATEMENT';

export interface StatementData {
  statementType: string;
  accountNumber: string;
  period: string;
  totalInvoiced?: string;
  totalSettled?: string;
  closingBalance?: string;
  pendingInvoicesCount?: number;
  unsettledAmount?: string;
  nextDueDate?: string;
  status: string;
  generatedAt: string;
}

export interface GroupMemberSummary {
  name: string;
  phone: string;
  role: 'Super Admin' | 'Admin' | 'Member';
}

export interface GroupQueryResponsePayload {
  groupDetails: {
    groupName: string;
    groupId: string;
    groupBio: string;
    createdAt: string;
    createdBy: string;
    totalParticipants: number;
    membersList: GroupMemberSummary[];
  };
  userDetails: {
    name: string;
    phone: string;
  };
  selectedOption: string;
  statementResponse: StatementData;
  timestamp: string;
}

export interface MakeWebhookPayload {
  event: string;
  groupId: string;
  userId: string;
  menuId: string;
  messageId: string;
  timestamp: string;
  extra?: Record<string, any>;
}

export interface SendMessageResponse {
  messaging_product: string;
  contacts?: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
    message_status?: string;
  }>;
}
