import { Injectable } from '@nestjs/common';
import {
  EnqueueOutboundInput,
  IPendingOutboundMessageRepository,
  OutboundStatus,
  PendingOutboundMessage,
} from 'src/domain/repositories/pending-outbound-message.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class PendingOutboundMessageRepository implements IPendingOutboundMessageRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async enqueue(items: EnqueueOutboundInput[]): Promise<void> {
    if (items.length === 0) return;

    await this.prismaService.pending_outbound_message.createMany({
      data: items.map((item) => ({
        conversationId: item.conversationId,
        userId: item.userId,
        toPhoneNumber: item.toPhoneNumber,
        content: item.content,
        nextAttemptAt: item.nextAttemptAt ?? new Date(),
      })),
    });
  }

  async findReadyToSend(limit: number): Promise<PendingOutboundMessage[]> {
    const records = await this.prismaService.pending_outbound_message.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });

    return records.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      userId: r.userId,
      toPhoneNumber: r.toPhoneNumber,
      content: r.content,
      attempts: r.attempts,
      status: r.status as OutboundStatus,
      lastError: r.lastError,
      nextAttemptAt: r.nextAttemptAt,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
    }));
  }

  async markSent(id: string): Promise<void> {
    await this.prismaService.pending_outbound_message.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }

  async markFailed(
    id: string,
    error: string,
    nextAttemptAt: Date,
    attempts: number,
  ): Promise<void> {
    await this.prismaService.pending_outbound_message.update({
      where: { id },
      data: {
        attempts,
        lastError: error.slice(0, 1000),
        nextAttemptAt,
      },
    });
  }

  async markPermanentlyFailed(id: string, error: string): Promise<void> {
    await this.prismaService.pending_outbound_message.update({
      where: { id },
      data: { status: 'FAILED', lastError: error.slice(0, 1000) },
    });
  }
}
