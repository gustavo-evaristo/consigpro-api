import { Injectable } from '@nestjs/common';
import {
  IMessageHistoryRepository,
  UpdateStatusResult,
} from 'src/domain/repositories/message-history.repository';
import {
  MediaType,
  MessageHistoryEntity,
  MessageSender,
  MessageStatus,
} from 'src/domain/entities/message-history.entity';
import { UUID } from 'src/domain/entities/vos';
import { PrismaService } from '../prisma.service';

@Injectable()
export class MessageHistoryRepository implements IMessageHistoryRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async create(message: MessageHistoryEntity): Promise<void> {
    await this.prismaService.message_history.create({
      data: {
        id: message.id.toString(),
        conversationId: message.conversationId.toString(),
        sender: message.sender,
        content: message.content,
        whatsappMessageId: message.whatsappMessageId,
        status: message.status,
        statusUpdatedAt: message.statusUpdatedAt,
        createdAt: message.createdAt,
        mediaUrl: message.mediaUrl,
        mediaType: message.mediaType,
      },
    });
  }

  async findManyByConversationId(
    conversationId: string,
  ): Promise<MessageHistoryEntity[]> {
    const records = await this.prismaService.message_history.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });

    return records.map((r) => this.toEntity(r));
  }

  async findManyByConversationIds(
    conversationIds: string[],
  ): Promise<MessageHistoryEntity[]> {
    const records = await this.prismaService.message_history.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: 'asc' },
    });

    return records.map((r) => this.toEntity(r));
  }

  async updateStatusByWhatsappId(
    whatsappMessageId: string,
    status: MessageStatus,
  ): Promise<UpdateStatusResult | null> {
    const existing = await this.prismaService.message_history.findUnique({
      where: { whatsappMessageId },
    });

    if (!existing) return null;

    // Status só evolui — nunca regride (READ não vira DELIVERED).
    const rank = this.statusRank(existing.status as MessageStatus);
    const newRank = this.statusRank(status);
    if (newRank <= rank) return null;

    const statusUpdatedAt = new Date();
    await this.prismaService.message_history.update({
      where: { whatsappMessageId },
      data: { status, statusUpdatedAt },
    });

    return {
      conversationId: existing.conversationId,
      whatsappMessageId,
      status,
      statusUpdatedAt,
    };
  }

  async findByWhatsappId(
    whatsappMessageId: string,
  ): Promise<MessageHistoryEntity | null> {
    const r = await this.prismaService.message_history.findUnique({
      where: { whatsappMessageId },
    });
    return r ? this.toEntity(r) : null;
  }

  async findUnreadLeadMessages(
    conversationId: string,
  ): Promise<MessageHistoryEntity[]> {
    const records = await this.prismaService.message_history.findMany({
      where: {
        conversationId,
        sender: MessageSender.LEAD,
        status: { not: MessageStatus.READ },
        whatsappMessageId: { not: null },
      },
    });
    return records.map((r) => this.toEntity(r));
  }

  private toEntity(r: {
    id: string;
    conversationId: string;
    sender: string;
    content: string;
    whatsappMessageId: string | null;
    status: string;
    statusUpdatedAt: Date | null;
    createdAt: Date;
    mediaUrl?: string | null;
    mediaType?: string | null;
  }): MessageHistoryEntity {
    return new MessageHistoryEntity({
      id: UUID.from(r.id),
      conversationId: UUID.from(r.conversationId),
      sender: r.sender as MessageSender,
      content: r.content,
      whatsappMessageId: r.whatsappMessageId,
      status: r.status as MessageStatus,
      statusUpdatedAt: r.statusUpdatedAt,
      createdAt: r.createdAt,
      mediaUrl: r.mediaUrl ?? null,
      mediaType: (r.mediaType as MediaType | null) ?? null,
    });
  }

  private statusRank(status: MessageStatus): number {
    switch (status) {
      case MessageStatus.PENDING:
        return 0;
      case MessageStatus.FAILED:
        return 0;
      case MessageStatus.SENT:
        return 1;
      case MessageStatus.DELIVERED:
        return 2;
      case MessageStatus.READ:
        return 3;
      default:
        return -1;
    }
  }
}
