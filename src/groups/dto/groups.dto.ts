import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateGroupDto {
  @IsNotEmpty()
  @IsString()
  whatsappGroupId: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class AddParticipantDto {
  @IsNotEmpty()
  @IsString()
  whatsappUserId: string;

  @IsOptional()
  @IsString()
  status?: string;
}
