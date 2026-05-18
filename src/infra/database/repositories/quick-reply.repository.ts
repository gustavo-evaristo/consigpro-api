import { Injectable } from '@nestjs/common';
import { QuickReplyEntity } from 'src/domain/entities/quick-reply.entity';
import { IQuickReplyRepository } from 'src/domain/repositories/quick-reply.repository';
import { UUID } from 'src/domain/entities/vos';
import { PrismaService } from '../prisma.service';

@Injectable()
export class QuickReplyRepository implements IQuickReplyRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async listByUserId(userId: string): Promise<QuickReplyEntity[]> {
    const rows = await this.prismaService.quick_replies.findMany({
      where: { userId },
      orderBy: { shortcut: 'asc' },
    });
    return rows.map(
      (r) =>
        new QuickReplyEntity({
          ...r,
          id: UUID.from(r.id),
          userId: UUID.from(r.userId),
        }),
    );
  }

  async getById(id: string): Promise<QuickReplyEntity | null> {
    const row = await this.prismaService.quick_replies.findUnique({
      where: { id },
    });
    if (!row) return null;
    return new QuickReplyEntity({
      ...row,
      id: UUID.from(row.id),
      userId: UUID.from(row.userId),
    });
  }

  async create(quickReply: QuickReplyEntity): Promise<void> {
    await this.prismaService.quick_replies.create({
      data: {
        id: quickReply.id.toString(),
        userId: quickReply.userId.toString(),
        shortcut: quickReply.shortcut,
        content: quickReply.content,
        createdAt: quickReply.createdAt,
        updatedAt: quickReply.updatedAt,
      },
    });
  }

  async save(quickReply: QuickReplyEntity): Promise<void> {
    await this.prismaService.quick_replies.update({
      where: { id: quickReply.id.toString() },
      data: {
        shortcut: quickReply.shortcut,
        content: quickReply.content,
        updatedAt: quickReply.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prismaService.quick_replies.delete({ where: { id } });
  }
}
