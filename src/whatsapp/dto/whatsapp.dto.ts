import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class WebhookVerifyQueryDto {
  @IsNotEmpty()
  @IsString()
  'hub.mode': string;

  @IsNotEmpty()
  @IsString()
  'hub.verify_token': string;

  @IsNotEmpty()
  @IsString()
  'hub.challenge': string;
}

export class SendGroupMessageDto {
  @IsNotEmpty({ message: 'groupId is required' })
  @IsString()
  groupId: string;

  @IsNotEmpty({ message: 'message is required' })
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  previewUrl?: boolean;
}
