import { Injectable } from '@nestjs/common';
import { KanbanStageEntity } from 'src/domain/entities/kanban-stage.entity';
import { UUID } from 'src/domain/entities/vos';
import {
  IKanbanStageRepository,
  KanbanStageUsage,
} from 'src/domain/repositories/kanban-stage.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class KanbanStageRepository implements IKanbanStageRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async listByKanbanId(kanbanId: string): Promise<KanbanStageEntity[]> {
    const rows = await this.prismaService.kanban_stages.findMany({
      where: { kanbanId, isDeleted: false },
      orderBy: { order: 'asc' },
    });
    return rows.map(
      (r) =>
        new KanbanStageEntity({
          ...r,
          id: UUID.from(r.id),
          kanbanId: UUID.from(r.kanbanId),
        }),
    );
  }

  async getById(id: string): Promise<KanbanStageEntity | null> {
    const row = await this.prismaService.kanban_stages.findUnique({
      where: { id, isDeleted: false },
    });
    if (!row) return null;
    return new KanbanStageEntity({
      ...row,
      id: UUID.from(row.id),
      kanbanId: UUID.from(row.kanbanId),
    });
  }

  async create(stage: KanbanStageEntity): Promise<void> {
    await this.prismaService.kanban_stages.create({
      data: {
        id: stage.id.toString(),
        kanbanId: stage.kanbanId.toString(),
        title: stage.title,
        color: stage.color,
        order: stage.order,
        isDeleted: stage.isDeleted,
        createdAt: stage.createdAt,
        updatedAt: stage.updatedAt,
      },
    });
  }

  async save(stage: KanbanStageEntity): Promise<void> {
    await this.prismaService.kanban_stages.update({
      where: { id: stage.id.toString() },
      data: {
        title: stage.title,
        color: stage.color,
        order: stage.order,
        isDeleted: stage.isDeleted,
        updatedAt: stage.updatedAt,
      },
    });
  }

  async getMaxOrder(kanbanId: string): Promise<number> {
    const result = await this.prismaService.kanban_stages.aggregate({
      where: { kanbanId, isDeleted: false },
      _max: { order: true },
    });
    return result._max.order ?? 0;
  }

  async getUsage(stageId: string): Promise<KanbanStageUsage> {
    const [leadsCount, flowNodesCount] = await Promise.all([
      this.prismaService.conversation_progress.count({
        where: { lastKanbanStageId: stageId },
      }),
      this.prismaService.flow_nodes.count({
        where: {
          OR: [{ kanbanStageId: stageId }, { postFillKanbanStageId: stageId }],
        },
      }),
    ]);
    return { leadsCount, flowNodesCount };
  }

  async reassignAndDelete(
    stageId: string,
    targetStageId: string | null,
  ): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      // Migra leads que estavam neste estágio para o destino (ou null)
      await tx.conversation_progress.updateMany({
        where: { lastKanbanStageId: stageId },
        data: { lastKanbanStageId: targetStageId },
      });
      // Migra nós de fluxo que apontavam para este estágio
      await tx.flow_nodes.updateMany({
        where: { kanbanStageId: stageId },
        data: { kanbanStageId: targetStageId },
      });
      await tx.flow_nodes.updateMany({
        where: { postFillKanbanStageId: stageId },
        data: { postFillKanbanStageId: targetStageId },
      });
      await tx.kanban_stages.update({
        where: { id: stageId },
        data: { isDeleted: true, updatedAt: new Date() },
      });
    });
  }
}
