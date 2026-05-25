import { Injectable } from '@nestjs/common';
import {
  ConversationDetail,
  ConversationSummary,
  IConversationRepository,
  LeadSummary,
} from 'src/domain/repositories/conversation.repository';
import {
  ConversationEntity,
  ConversationStatus,
} from 'src/domain/entities/conversation.entity';
import { UUID } from 'src/domain/entities/vos';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ConversationRepository implements IConversationRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async create(conversation: ConversationEntity): Promise<void> {
    await this.prismaService.conversations.create({
      data: {
        id: conversation.id.toString(),
        flowId: conversation.flowId.toString(),
        leadPhoneNumber: conversation.leadPhoneNumber,
        leadName: conversation.leadName,
        status: conversation.status,
        automationEnabled: conversation.automationEnabled,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    // Hard-delete cascata por (flowId, leadPhoneNumber). Apagar so a conversa
    // atual nao bastava: o GetConversationUseCase une mensagens de TODAS as
    // conversas anteriores do mesmo lead/flow (findIdsByLeadAndKanban), entao
    // historico de conversas FINISHED antigas reaparecia quando o lead voltava
    // 48h depois. Aqui apagamos tudo relacionado: o lead "renasce" do zero.
    await this.prismaService.$transaction(async (tx) => {
      const conv = await tx.conversations.findUnique({
        where: { id },
        select: { flowId: true, leadPhoneNumber: true },
      });
      if (!conv) return;

      const allConvIds = (
        await tx.conversations.findMany({
          where: {
            flowId: conv.flowId,
            leadPhoneNumber: conv.leadPhoneNumber,
          },
          select: { id: true },
        })
      ).map((c) => c.id);

      if (allConvIds.length === 0) return;

      const whereIn = { conversationId: { in: allConvIds } };

      await tx.message_history.deleteMany({ where: whereIn });
      await tx.conversation_progress.deleteMany({ where: whereIn });
      await tx.lead_responses.deleteMany({ where: whereIn });
      await tx.pending_outbound_message.deleteMany({ where: whereIn });
      await tx.conversations.deleteMany({ where: { id: { in: allConvIds } } });
    });
  }

  async findActive(
    flowId: string,
    leadPhoneNumber: string,
  ): Promise<ConversationEntity | null> {
    const conversation = await this.prismaService.conversations.findFirst({
      where: {
        flowId,
        leadPhoneNumber,
        status: ConversationStatus.ACTIVE,
        isDeleted: false,
      },
    });

    if (!conversation) return null;

    return new ConversationEntity({
      ...conversation,
      id: UUID.from(conversation.id),
      flowId: UUID.from(conversation.flowId),
    });
  }

  async update(conversation: ConversationEntity): Promise<void> {
    await this.prismaService.conversations.update({
      where: { id: conversation.id.toString() },
      data: {
        status: conversation.status,
        automationEnabled: conversation.automationEnabled,
        updatedAt: conversation.updatedAt,
      },
    });
  }

  async findManyByUserId(userId: string): Promise<ConversationSummary[]> {
    type Row = {
      id: string;
      leadPhoneNumber: string;
      leadName: string | null;
      status: string;
      automationEnabled: boolean;
      flowId: string;
      flowTitle: string;
      flowKanbanId: string | null;
      kanbanStageId: string | null;
      kanbanStageName: string | null;
      kanbanStageColor: string | null;
      lastMessageContent: string | null;
      lastMessageSender: string | null;
      lastMessageSentAt: Date | null;
      unreadCount: number | bigint;
      createdAt: Date;
      updatedAt: Date;
    };

    const rows = await this.prismaService.$queryRaw<Row[]>`
      SELECT * FROM (
        SELECT DISTINCT ON (c."leadPhoneNumber", c."flowId")
          c.id,
          c."leadPhoneNumber",
          c."leadName",
          c.status,
          c."automationEnabled",
          k.id           AS "flowId",
          k.title        AS "flowTitle",
          k."kanbanId"   AS "flowKanbanId",
          ks.id          AS "kanbanStageId",
          ks.title       AS "kanbanStageName",
          ks.color       AS "kanbanStageColor",
          mh.content     AS "lastMessageContent",
          mh.sender      AS "lastMessageSender",
          mh."createdAt" AS "lastMessageSentAt",
          COALESCE(uc."unreadCount", 0) AS "unreadCount",
          c."createdAt",
          c."updatedAt"
        FROM conversations c
        JOIN flows k ON k.id = c."flowId"
        LEFT JOIN conversation_progress cp ON cp."conversationId" = c.id
        LEFT JOIN kanban_stages ks ON ks.id = cp."lastKanbanStageId"
          AND ks."isDeleted" = false
        LEFT JOIN LATERAL (
          SELECT content, sender, "createdAt"
          FROM message_history
          WHERE "conversationId" = c.id
          ORDER BY "createdAt" DESC
          LIMIT 1
        ) mh ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "unreadCount"
          FROM message_history
          WHERE "conversationId" = c.id
            AND sender = 'LEAD'
            AND status <> 'READ'
        ) uc ON true
        WHERE k."userId" = ${userId}
          AND k."isDeleted" = false
          AND c."isDeleted" = false
          AND c."leadPhoneNumber" ~ '^[+][0-9]{10,15}$'
        ORDER BY c."leadPhoneNumber", c."flowId", c."updatedAt" DESC
      ) latest
      ORDER BY COALESCE(latest."lastMessageSentAt", latest."updatedAt") DESC
    `;

    return rows.map((r) => ({
      id: r.id,
      leadPhoneNumber: r.leadPhoneNumber,
      leadName: r.leadName,
      status: r.status,
      automationEnabled: r.automationEnabled,
      flowId: r.flowId,
      flowTitle: r.flowTitle,
      flowKanbanId: r.flowKanbanId ?? null,
      kanbanStageId: r.kanbanStageId ?? null,
      kanbanStageName: r.kanbanStageName ?? null,
      kanbanStageColor: r.kanbanStageColor ?? null,
      lastMessage:
        r.lastMessageContent !== null &&
        r.lastMessageSender !== null &&
        r.lastMessageSentAt !== null
          ? {
              content: r.lastMessageContent,
              sender: r.lastMessageSender,
              sentAt: r.lastMessageSentAt,
            }
          : null,
      unreadCount: Number(r.unreadCount ?? 0),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async findById(id: string): Promise<ConversationDetail | null> {
    const r = await this.prismaService.conversations.findUnique({
      where: { id },
      include: {
        flow: { select: { title: true, userId: true } },
      },
    });

    if (!r) return null;

    return {
      id: r.id,
      flowId: r.flowId,
      leadPhoneNumber: r.leadPhoneNumber,
      leadName: r.leadName,
      status: r.status,
      automationEnabled: r.automationEnabled,
      flowTitle: r.flow.title,
      flowUserId: r.flow.userId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async findByIdAsEntity(id: string): Promise<ConversationEntity | null> {
    const r = await this.prismaService.conversations.findUnique({
      where: { id },
    });

    if (!r || r.isDeleted) return null;

    return new ConversationEntity({
      ...r,
      id: UUID.from(r.id),
      flowId: UUID.from(r.flowId),
    });
  }

  async findLeadsByUserId(userId: string): Promise<LeadSummary[]> {
    type Row = {
      id: string;
      leadPhoneNumber: string;
      leadName: string | null;
      status: string;
      flowId: string;
      flowTitle: string;
      kanbanStageId: string | null;
      kanbanStageName: string | null;
      kanbanStageColor: string | null;
      createdAt: Date;
    };

    // Em uma query: pega o último contato de cada (lead, fluxo) e já junta
    // com o estágio kanban atual via conversation_progress.lastKanbanStageId.
    const rows = await this.prismaService.$queryRaw<Row[]>`
      SELECT * FROM (
        SELECT DISTINCT ON (c."leadPhoneNumber", c."flowId")
          c.id,
          c."leadPhoneNumber",
          c."leadName",
          c.status,
          k.id    AS "flowId",
          k.title AS "flowTitle",
          ks.id    AS "kanbanStageId",
          ks.title AS "kanbanStageName",
          ks.color AS "kanbanStageColor",
          c."createdAt"
        FROM conversations c
        JOIN flows k ON k.id = c."flowId"
        LEFT JOIN conversation_progress cp ON cp."conversationId" = c.id
        LEFT JOIN kanban_stages ks
          ON ks.id = cp."lastKanbanStageId"
         AND ks."isDeleted" = false
        WHERE k."userId" = ${userId}
          AND k."isDeleted" = false
          AND c."isDeleted" = false
          AND c."leadPhoneNumber" ~ '^[+][0-9]{10,15}$'
        ORDER BY c."leadPhoneNumber", c."flowId", c."updatedAt" DESC
      ) leads
      ORDER BY leads."createdAt" DESC
    `;

    return rows;
  }

  async findLastFinished(
    flowId: string,
    leadPhoneNumber: string,
  ): Promise<ConversationEntity | null> {
    const r = await this.prismaService.conversations.findFirst({
      where: {
        flowId,
        leadPhoneNumber,
        status: ConversationStatus.FINISHED,
        isDeleted: false,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!r) return null;

    return new ConversationEntity({
      ...r,
      id: UUID.from(r.id),
      flowId: UUID.from(r.flowId),
    });
  }

  async findIdsByLeadAndKanban(
    flowId: string,
    leadPhoneNumber: string,
  ): Promise<string[]> {
    const records = await this.prismaService.conversations.findMany({
      where: { flowId, leadPhoneNumber, isDeleted: false },
      select: { id: true },
    });

    return records.map((r) => r.id);
  }

  async findByLeadPhone(
    userId: string,
    leadPhoneNumber: string,
  ): Promise<ConversationEntity | null> {
    const r = await this.prismaService.conversations.findFirst({
      where: {
        leadPhoneNumber,
        isDeleted: false,
        flow: { userId, isDeleted: false },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!r) return null;

    return new ConversationEntity({
      ...r,
      id: UUID.from(r.id),
      flowId: UUID.from(r.flowId),
    });
  }
}
