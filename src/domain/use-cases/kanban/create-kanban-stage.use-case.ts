import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { UUID } from 'src/domain/entities/vos';
import { KanbanStageEntity } from 'src/domain/entities/kanban-stage.entity';
import { IKanbanRepository } from 'src/domain/repositories/kanban.repository';
import { IKanbanStageRepository } from 'src/domain/repositories/kanban-stage.repository';

interface Input {
  userId: string;
  kanbanId: string;
  title: string;
  color?: string | null;
}

@Injectable()
export class CreateKanbanStageUseCase {
  constructor(
    private readonly kanbanRepository: IKanbanRepository,
    private readonly stageRepository: IKanbanStageRepository,
  ) {}

  async execute({ userId, kanbanId, title, color }: Input) {
    const kanban = await this.kanbanRepository.getById(kanbanId);
    if (!kanban) throw new NotFoundException('Kanban não encontrado');
    if (!kanban.belongsTo(UUID.from(userId))) throw new ForbiddenException();

    const maxOrder = await this.stageRepository.getMaxOrder(kanbanId);
    const stage = new KanbanStageEntity({
      kanbanId,
      title,
      color,
      order: maxOrder + 1,
    });
    await this.stageRepository.create(stage);
    return { id: stage.id.value };
  }
}
