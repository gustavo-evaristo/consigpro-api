import { Injectable } from '@nestjs/common';
import { IWhatsappStatusRepository } from 'src/domain/repositories/whatsapp-status.repository';
import { IWhatsAppSessionRepository } from 'src/domain/repositories/whatsapp-session.repository';

@Injectable()
export class WhatsappStatusRepository implements IWhatsappStatusRepository {
  constructor(private readonly sessionRepository: IWhatsAppSessionRepository) {}

  async getConnectedPhone(userId: string): Promise<string | null> {
    const info = await this.sessionRepository.getConnectionInfo(userId);
    if (!info) return null;
    if (info.status !== 'CONNECTED') return null;
    return info.connectedPhone;
  }
}
