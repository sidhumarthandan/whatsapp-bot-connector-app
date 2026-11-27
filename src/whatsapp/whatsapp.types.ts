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

export interface MakeWebhookPayload {
  event: string;
  groupId: string;
  userId: string;
  menuId: string;
  option?: string;
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
