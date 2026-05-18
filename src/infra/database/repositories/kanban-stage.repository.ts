import { Injectable } from '@nestjs/common';
import { KanbanStageEntity } from 'src/domain/entities/kanban-stage.entity';
import { UUID } from 'src/domain/entities/vos';
import { IKanbanStageRepository } from 'src/domain/repositories/kanban-stage.repository';
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
}
