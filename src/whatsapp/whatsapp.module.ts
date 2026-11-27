import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WhatsappController } from './whatsapp.controller';
import { WahaController } from './waha.controller';
import { StatementsController } from './statements.controller';
import { WhatsappService } from './whatsapp.service';
import { GroupsModule } from '../groups/groups.module';
import { MetaSignatureGuard } from '../common/guards/meta-signature.guard';

@Module({
  imports: [HttpModule, GroupsModule],
  controllers: [WhatsappController, WahaController, StatementsController],
  providers: [WhatsappService, MetaSignatureGuard],
  exports: [WhatsappService],
})
export class WhatsappModule {}
