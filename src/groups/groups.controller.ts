import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { CreateGroupDto, AddParticipantDto } from './dto/groups.dto';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  async listGroups() {
    const groups = await this.groupsService.listGroups();
    return {
      success: true,
      total: groups.length,
      data: groups,
    };
  }

  @Get(':id')
  async getGroupDetails(@Param('id') id: string) {
    const group = await this.groupsService.getGroupDetails(id);
    if (!group) {
      throw new NotFoundException(`Group '${id}' not found in in-memory store`);
    }
    return {
      success: true,
      data: group,
    };
  }

  @Get(':id/interactions')
  async getGroupInteractions(@Param('id') id: string) {
    const interactions = await this.groupsService.getInteractions(id);
    return {
      success: true,
      data: interactions,
    };
  }

  @Post()
  async createGroup(@Body() dto: CreateGroupDto) {
    const group = await this.groupsService.upsertGroup(
      dto.whatsappGroupId,
      dto.groupName,
      dto.status,
    );
    return {
      success: true,
      message: 'Group saved successfully in JSON store',
      data: group,
    };
  }

  @Post(':id/participants')
  async addParticipant(@Param('id') id: string, @Body() dto: AddParticipantDto) {
    const participant = await this.groupsService.upsertParticipant(
      id,
      dto.whatsappUserId,
      dto.status,
    );
    return {
      success: true,
      message: 'Participant updated successfully',
      data: participant,
    };
  }
}
