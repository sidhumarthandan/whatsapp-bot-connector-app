import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  HttpCode,
  UseGuards,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { WebhookVerifyQueryDto, SendGroupMessageDto } from './dto/whatsapp.dto';
import { MetaSignatureGuard } from '../common/guards/meta-signature.guard';

@Controller('webhook/whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Webhook verification endpoint required by Meta WhatsApp Platform
   */
  @Get()
  verifyWebhook(
    @Query() query: WebhookVerifyQueryDto,
    @Res() res: Response,
  ) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    const expectedToken = this.configService.get<string>('META_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === expectedToken) {
      this.logger.log('Meta webhook successfully verified');
      return res.status(HttpStatus.OK).send(challenge);
    }

    this.logger.warn(
      `Webhook verification failed: mode=${mode}, tokenMismatch=${token !== expectedToken}`,
    );
    return res.status(HttpStatus.FORBIDDEN).send('Verification token mismatch');
  }

  /**
   * Incoming WhatsApp event receiver endpoint
   */
  @Post()
  @UseGuards(MetaSignatureGuard)
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(@Body() payload: any) {
    await this.whatsappService.processWebhook(payload);
    return {
      success: true,
    };
  }

  /**
   * Send dynamic message to a WhatsApp group endpoint (Section 6.4)
   */
  @Post('send-group-message')
  @HttpCode(HttpStatus.OK)
  async sendGroupMessage(@Body() body: SendGroupMessageDto) {
    const result = await this.whatsappService.sendGroupMessage(
      body.groupId,
      body.message,
    );
    return {
      success: true,
      data: result,
    };
  }
}
