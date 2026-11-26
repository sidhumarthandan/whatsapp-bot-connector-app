import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { WhatsappGroup, GroupParticipant, MenuInteraction } from './groups.types';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  // In-memory dummy JSON datastore
  private groups: Map<string, WhatsappGroup> = new Map();

  constructor() {
    this.seedDummyData();
  }

  private seedDummyData() {
    const groupA: WhatsappGroup = {
      id: crypto.randomUUID(),
      whatsappGroupId: 'GROUP_ID_A',
      groupName: 'Group A - General Announcements',
      status: 'ACTIVE',
      participants: [
        {
          id: crypto.randomUUID(),
          groupId: 'GROUP_ID_A',
          whatsappUserId: '919876543210',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
        {
          id: crypto.randomUUID(),
          groupId: 'GROUP_ID_A',
          whatsappUserId: '919123456789',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      ],
      interactions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const groupB: WhatsappGroup = {
      id: crypto.randomUUID(),
      whatsappGroupId: 'GROUP_ID_B',
      groupName: 'Group B - Customer Support',
      status: 'ACTIVE',
      participants: [
        {
          id: crypto.randomUUID(),
          groupId: 'GROUP_ID_B',
          whatsappUserId: '919876543210',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      ],
      interactions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.groups.set(groupA.whatsappGroupId, groupA);
    this.groups.set(groupB.whatsappGroupId, groupB);
    this.logger.log('Dummy in-memory groups initialized: GROUP_ID_A, GROUP_ID_B');
  }

  async listGroups(): Promise<WhatsappGroup[]> {
    return Array.from(this.groups.values());
  }

  async getGroupDetails(idOrWhatsappId: string): Promise<WhatsappGroup | null> {
    for (const group of this.groups.values()) {
      if (group.id === idOrWhatsappId || group.whatsappGroupId === idOrWhatsappId) {
        return group;
      }
    }
    return null;
  }

  async findGroupByWhatsappId(whatsappGroupId: string): Promise<WhatsappGroup | null> {
    return this.groups.get(whatsappGroupId) || null;
  }

  async upsertGroup(
    whatsappGroupId: string,
    groupName?: string,
    status: string = 'ACTIVE',
  ): Promise<WhatsappGroup> {
    let group = this.groups.get(whatsappGroupId);

    if (group) {
      if (groupName) group.groupName = groupName;
      group.status = status;
      group.updatedAt = new Date();
      this.logger.log(`Updated group in-memory: ${whatsappGroupId}`);
    } else {
      group = {
        id: crypto.randomUUID(),
        whatsappGroupId,
        groupName: groupName || `WhatsApp Group ${whatsappGroupId}`,
        status,
        participants: [],
        interactions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.groups.set(whatsappGroupId, group);
      this.logger.log(`Created new group in-memory: ${whatsappGroupId}`);
    }

    return group;
  }

  async upsertParticipant(
    whatsappGroupId: string,
    whatsappUserId: string,
    status: string = 'ACTIVE',
  ): Promise<GroupParticipant> {
    let group = this.groups.get(whatsappGroupId);
    if (!group) {
      group = await this.upsertGroup(whatsappGroupId);
    }

    let participant = group.participants.find(
      (p) => p.whatsappUserId === whatsappUserId,
    );

    if (participant) {
      participant.status = status;
    } else {
      participant = {
        id: crypto.randomUUID(),
        groupId: whatsappGroupId,
        whatsappUserId,
        status,
        joinedAt: new Date(),
      };
      group.participants.push(participant);
      this.logger.log(
        `Added participant ${whatsappUserId} to group ${whatsappGroupId}`,
      );
    }

    return participant;
  }

  async recordMenuInteraction(
    whatsappGroupId: string,
    userPhone: string,
    menuId: string,
    messageId: string,
  ): Promise<MenuInteraction> {
    let group = this.groups.get(whatsappGroupId);
    if (!group) {
      group = await this.upsertGroup(whatsappGroupId);
    }

    const interaction: MenuInteraction = {
      id: crypto.randomUUID(),
      groupId: whatsappGroupId,
      userPhone,
      menuId,
      messageId,
      clickedAt: new Date(),
    };

    group.interactions.push(interaction);
    this.logger.log(
      `Recorded interaction in-memory: Group=${whatsappGroupId}, User=${userPhone}, Menu=${menuId}, Msg=${messageId}`,
    );

    return interaction;
  }

  async getInteractions(whatsappGroupId?: string): Promise<MenuInteraction[]> {
    if (whatsappGroupId) {
      const group = await this.getGroupDetails(whatsappGroupId);
      return group ? group.interactions : [];
    }

    return Array.from(this.groups.values()).flatMap((g) => g.interactions);
  }
}
