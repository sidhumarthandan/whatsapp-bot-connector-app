import { Controller, Get, Query } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('statements')
export class StatementsController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('closing')
  async getClosingStatement(
    @Query('groupId') groupId?: string,
    @Query('groupName') groupName?: string,
    @Query('senderName') senderName?: string,
    @Query('senderPhone') senderPhone?: string,
  ) {
    const groupDetails = groupId
      ? await this.whatsappService.getGroupDetailsForApi(groupId)
      : null;
    const data = this.whatsappService.getStatementData('CLOSING_STATEMENT');
    return {
      success: true,
      queryType: 'CLOSING_STATEMENT',
      ...(senderName ? { senderName } : {}),
      ...(senderPhone ? { senderPhone } : {}),
      ...(groupId ? { groupId } : {}),
      ...(groupName || groupDetails?.groupName
        ? { groupName: groupName || groupDetails?.groupName }
        : {}),
      data,
    };
  }

  @Get('unsettled')
  async getUnsettledStatement(
    @Query('groupId') groupId?: string,
    @Query('groupName') groupName?: string,
    @Query('senderName') senderName?: string,
    @Query('senderPhone') senderPhone?: string,
  ) {
    const groupDetails = groupId
      ? await this.whatsappService.getGroupDetailsForApi(groupId)
      : null;
    const data = this.whatsappService.getStatementData('UNSETTLED_STATEMENT');
    return {
      success: true,
      queryType: 'UNSETTLED_STATEMENT',
      ...(senderName ? { senderName } : {}),
      ...(senderPhone ? { senderPhone } : {}),
      ...(groupId ? { groupId } : {}),
      ...(groupName || groupDetails?.groupName
        ? { groupName: groupName || groupDetails?.groupName }
        : {}),
      data,
    };
  }
}
