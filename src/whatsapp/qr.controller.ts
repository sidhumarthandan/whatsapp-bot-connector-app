import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { BaileysService } from './baileys.service';

@Controller('qr')
export class QrController {
  constructor(private readonly baileysService: BaileysService) {}

  @Get('reset')
  async resetQrSession(@Res() res: Response) {
    await this.baileysService.resetSession();
    return res.redirect('/qr');
  }

  @Get()
  getQrPage(@Res() res: Response) {
    if (this.baileysService.isConnected) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>WhatsApp Bot - Connected</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 50px; background: #f0fdf4; }
            .card { background: white; max-width: 480px; margin: 0 auto; padding: 30px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
            h1 { color: #16a34a; font-size: 24px; margin-bottom: 12px; }
            p { color: #4b5563; line-height: 1.6; }
            .btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #ef4444; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ WhatsApp Bot Connected!</h1>
            <p>Your WhatsApp Web session is active and linked successfully.</p>
            <p>The bot is currently listening to your approved WhatsApp groups.</p>
            <a href="/qr/reset" class="btn">Disconnect & Re-scan</a>
          </div>
        </body>
        </html>
      `);
    }

    if (!this.baileysService.qrDataUrl) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="2">
          <title>Generating QR...</title>
          <style>
            body { font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #f8fafc; }
            .card { background: white; max-width: 420px; margin: 0 auto; padding: 30px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
            .btn { display: inline-block; margin-top: 15px; padding: 8px 16px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>⏳ Generating QR Code...</h2>
            <p style="color: #64748b;">Waiting for a fresh QR code from WhatsApp Web.</p>
            <a href="/qr/reset" class="btn">🔄 Force New QR Code</a>
          </div>
        </body>
        </html>
      `);
    }

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta http-equiv="refresh" content="15">
        <title>Scan WhatsApp QR Code</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 40px; background: #f8fafc; }
          .card { background: white; max-width: 460px; margin: 0 auto; padding: 32px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
          h1 { color: #0f172a; font-size: 22px; margin-bottom: 8px; }
          p { color: #64748b; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
          img { border: 12px solid white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); width: 280px; height: 280px; }
          .steps { text-align: left; background: #f1f5f9; padding: 16px 20px; border-radius: 10px; margin-top: 24px; font-size: 13px; color: #334155; }
          ol { margin: 0; padding-left: 20px; }
          li { margin-bottom: 6px; }
          .reset { display: block; margin-top: 20px; font-size: 13px; color: #dc2626; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>📲 Scan with WhatsApp</h1>
          <p>Point your phone camera to link this bot with your WhatsApp groups.</p>
          <img src="${this.baileysService.qrDataUrl}" alt="WhatsApp QR Code" />
          <div class="steps">
            <strong>How to scan:</strong>
            <ol>
              <li>Open <b>WhatsApp</b> on your phone</li>
              <li>Go to <b>Settings</b> &rarr; <b>Linked Devices</b></li>
              <li>Tap <b>Link a Device</b> and point at this screen</li>
            </ol>
          </div>
          <a href="/qr/reset" class="reset">🔄 Having trouble? Click here to regenerate fresh QR</a>
        </div>
      </body>
      </html>
    `);
  }
}
