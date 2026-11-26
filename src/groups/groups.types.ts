export interface GroupParticipant {
  id: string;
  groupId: string;
  whatsappUserId: string;
  status: string;
  joinedAt: Date;
}

export interface MenuInteraction {
  id: string;
  groupId: string;
  userPhone: string;
  menuId: string;
  messageId: string;
  clickedAt: Date;
}

export interface WhatsappGroup {
  id: string;
  whatsappGroupId: string;
  groupName: string;
  status: string;
  participants: GroupParticipant[];
  interactions: MenuInteraction[];
  createdAt: Date;
  updatedAt: Date;
}
