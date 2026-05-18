import { WhatsAppSessionEntity } from '../entities/whatsapp-session.entity';

export type WhatsappConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'PENDING';

export interface WhatsappConnectionInfo {
  status: WhatsappConnectionStatus;
  connectedPhone: string | null;
  lastSeenAt: Date | null;
}

export abstract class IWhatsAppSessionRepository {
  abstract findByUserId(userId: string): Promise<WhatsAppSessionEntity | null>;
  abstract save(session: WhatsAppSessionEntity): Promise<void>;
  abstract delete(userId: string): Promise<void>;
  abstract findAllUserIds(): Promise<string[]>;

  /**
   * Persist the live connection state so any instance can read it.
   * Only the leader (see LeaderElectionService) writes here.
   */
  abstract setConnectionStatus(
    userId: string,
    status: WhatsappConnectionStatus,
    connectedPhone: string | null,
  ): Promise<void>;

  /**
   * Reset all sessions to DISCONNECTED. Called on leader bootstrap so a
   * stale CONNECTED row from a dead instance does not lie to the dashboard.
   */
  abstract markAllDisconnected(): Promise<void>;

  abstract getConnectionInfo(
    userId: string,
  ): Promise<WhatsappConnectionInfo | null>;
}
