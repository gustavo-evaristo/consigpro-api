import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UUID } from 'src/domain/entities/vos';
import { IKanbanRepository } from 'src/domain/repositories/kanban.repository';
import { IKanbanStageRepository } from 'src/domain/repositories/kanban-stage.repository';
import { IConversationProgressRepository } from 'src/domain/repositories/conversation-progress.repository';

interface Input {
  userId: string;
  kanbanId: string;
  conversationId: string;
  targetStageId: string;
}

@Injectable()
export class MoveLeadStageUseCase {
  constructor(
    private readonly kanbanRepository: IKanbanRepository,
    private readonly stageRepository: IKanbanStageRepository,
    private readonly progressRepository: IConversationProgressRepository,
  ) {}

  async execute({
    userId,
    kanbanId,
    conversationId,
    targetStageId,
  }: Input): Promise<void> {
    const kanban = await this.kanbanRepository.getById(kanbanId);
    if (!kanban) throw new NotFoundException('Kanban não encontrado');
    if (!kanban.belongsTo(UUID.from(userId))) throw new ForbiddenException();

    const stage = await this.stageRepository.getById(targetStageId);
    if (!stage || stage.kanbanId.toString() !== kanbanId) {
      throw new NotFoundException('Estágio não encontrado');
    }

    const progress =
      await this.progressRepository.findByConversationId(conversationId);
    if (!progress) throw new NotFoundException('Conversa não encontrada');

    progress.recordKanbanStage(targetStageId);
    await this.progressRepository.update(progress);
  }
}
