import {
  MessageHistoryEntity,
  MessageStatus,
} from '../entities/message-history.entity';

export interface UpdateStatusResult {
  conversationId: string;
  status: MessageStatus;
  whatsappMessageId: string;
  statusUpdatedAt: Date;
}

export abstract class IMessageHistoryRepository {
  abstract create(message: MessageHistoryEntity): Promise<void>;
  abstract findManyByConversationId(
    conversationId: string,
  ): Promise<MessageHistoryEntity[]>;
  abstract findManyByConversationIds(
    conversationIds: string[],
  ): Promise<MessageHistoryEntity[]>;
  abstract updateStatusByWhatsappId(
    whatsappMessageId: string,
    status: MessageStatus,
  ): Promise<UpdateStatusResult | null>;
  abstract findUnreadLeadMessages(
    conversationId: string,
  ): Promise<MessageHistoryEntity[]>;
  abstract findByWhatsappId(
    whatsappMessageId: string,
  ): Promise<MessageHistoryEntity | null>;
}
