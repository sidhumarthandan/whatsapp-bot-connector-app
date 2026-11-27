import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WahaWebhookPayload } from './whatsapp.types';

@Controller('webhook/waha')
export class WahaController {
  constructor(private readonly whatsappService: WhatsappService) {}

  /**
   * Receives incoming WhatsApp events from WAHA (WhatsApp HTTP API)
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async receiveWahaWebhook(@Body() payload: WahaWebhookPayload) {
    await this.whatsappService.processWahaWebhook(payload);
    return {
      success: true,
    };
  }
}
