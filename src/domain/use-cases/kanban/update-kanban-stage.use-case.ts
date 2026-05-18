import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { UUID } from 'src/domain/entities/vos';
import { IKanbanRepository } from 'src/domain/repositories/kanban.repository';
import { IKanbanStageRepository } from 'src/domain/repositories/kanban-stage.repository';

interface Input {
  userId: string;
  kanbanId: string;
  stageId: string;
  title: string;
  color?: string | null;
  order?: number;
}

@Injectable()
export class UpdateKanbanStageUseCase {
  constructor(
    private readonly kanbanRepository: IKanbanRepository,
    private readonly stageRepository: IKanbanStageRepository,
  ) {}

  async execute({ userId, kanbanId, stageId, title, color, order }: Input) {
    const kanban = await this.kanbanRepository.getById(kanbanId);
    if (!kanban) throw new NotFoundException('Kanban não encontrado');
    if (!kanban.belongsTo(UUID.from(userId))) throw new ForbiddenException();

    const stage = await this.stageRepository.getById(stageId);
    if (!stage || stage.kanbanId.value !== kanbanId)
      throw new NotFoundException('Estágio não encontrado');

    stage.update(title, color, order);
    await this.stageRepository.save(stage);
  }
}
