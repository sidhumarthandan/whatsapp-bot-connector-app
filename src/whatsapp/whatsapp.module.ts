import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WhatsappController } from './whatsapp.controller';
import { QrController } from './qr.controller';
import { WhatsappService } from './whatsapp.service';
import { BaileysService } from './baileys.service';
import { GroupsModule } from '../groups/groups.module';
import { MetaSignatureGuard } from '../common/guards/meta-signature.guard';

@Module({
  imports: [HttpModule, GroupsModule],
  controllers: [WhatsappController, QrController],
  providers: [WhatsappService, BaileysService, MetaSignatureGuard],
  exports: [WhatsappService, BaileysService],
})
export class WhatsappModule {}
