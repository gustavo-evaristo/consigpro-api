import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { UUID } from 'src/domain/entities/vos';
import { IKanbanRepository } from 'src/domain/repositories/kanban.repository';

interface Input {
  userId: string;
  kanbanId: string;
}

@Injectable()
export class GetKanbanBoardUseCase {
  constructor(private readonly kanbanRepository: IKanbanRepository) {}

  async execute({ userId, kanbanId }: Input) {
    const kanban = await this.kanbanRepository.getById(kanbanId);
    if (!kanban) throw new NotFoundException('Kanban não encontrado');
    if (!kanban.belongsTo(UUID.from(userId))) throw new ForbiddenException();
    return this.kanbanRepository.getBoard(kanbanId);
  }
}
