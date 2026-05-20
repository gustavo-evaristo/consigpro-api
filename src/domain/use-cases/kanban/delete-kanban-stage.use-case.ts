import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UUID } from 'src/domain/entities/vos';
import { IKanbanRepository } from 'src/domain/repositories/kanban.repository';
import { IKanbanStageRepository } from 'src/domain/repositories/kanban-stage.repository';

interface Input {
  userId: string;
  kanbanId: string;
  stageId: string;
  targetStageId?: string;
}

@Injectable()
export class DeleteKanbanStageUseCase {
  constructor(
    private readonly kanbanRepository: IKanbanRepository,
    private readonly stageRepository: IKanbanStageRepository,
  ) {}

  async execute({ userId, kanbanId, stageId, targetStageId }: Input) {
    const kanban = await this.kanbanRepository.getById(kanbanId);
    if (!kanban) throw new NotFoundException('Kanban não encontrado');
    if (!kanban.belongsTo(UUID.from(userId))) throw new ForbiddenException();

    const stage = await this.stageRepository.getById(stageId);
    if (!stage || stage.kanbanId.value !== kanbanId)
      throw new NotFoundException('Estágio não encontrado');

    const usage = await this.stageRepository.getUsage(stageId);
    const hasUsage = usage.leadsCount > 0 || usage.flowNodesCount > 0;

    if (hasUsage && !targetStageId) {
      throw new ConflictException({
        code: 'STAGE_HAS_LEADS',
        message:
          'Esta coluna possui leads ou nós de fluxo vinculados. Escolha uma coluna de destino para movê-los antes de excluir.',
        leadsCount: usage.leadsCount,
        flowNodesCount: usage.flowNodesCount,
      });
    }

    if (targetStageId) {
      if (targetStageId === stageId) {
        throw new BadRequestException(
          'A coluna de destino deve ser diferente da que está sendo excluída.',
        );
      }
      const target = await this.stageRepository.getById(targetStageId);
      if (!target || target.kanbanId.value !== kanbanId) {
        throw new NotFoundException('Coluna de destino inválida');
      }
    }

    await this.stageRepository.reassignAndDelete(
      stageId,
      hasUsage ? targetStageId! : null,
    );
  }
}
