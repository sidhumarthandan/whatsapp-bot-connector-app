import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Request } from 'express';

@Injectable()
export class MetaSignatureGuard implements CanActivate {
  private readonly logger = new Logger(MetaSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const appSecret = this.configService.get<string>('META_APP_SECRET');

    // If appSecret is not configured, skip verification with a warning in non-production
    if (!appSecret || appSecret === 'YOUR_APP_SECRET' || appSecret === 'test_app_secret') {
      this.logger.debug('Meta app secret is not configured or in test mode; skipping signature check.');
      return true;
    }

    const signature = request.headers['x-hub-signature-256'] as string;
    if (!signature) {
      this.logger.warn('Missing x-hub-signature-256 header on incoming webhook');
      throw new UnauthorizedException('Missing x-hub-signature-256 header');
    }

    // rawBody is populated by NestJS with rawBody: true option
    const rawBody = (request as any).rawBody;
    const bodyBuffer = rawBody || Buffer.from(JSON.stringify(request.body));

    const expectedSignature =
      'sha256=' +
      crypto
        .createHmac('sha256', appSecret)
        .update(bodyBuffer)
        .digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );

    if (!isValid) {
      this.logger.error('Invalid Meta webhook signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
