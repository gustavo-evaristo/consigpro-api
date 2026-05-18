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
  title: string;
  description?: string | null;
}

@Injectable()
export class UpdateKanbanUseCase {
  constructor(private readonly kanbanRepository: IKanbanRepository) {}

  async execute({ userId, kanbanId, title, description }: Input) {
    const kanban = await this.kanbanRepository.getById(kanbanId);
    if (!kanban) throw new NotFoundException('Kanban não encontrado');
    if (!kanban.belongsTo(UUID.from(userId))) throw new ForbiddenException();
    kanban.update(title, description);
    await this.kanbanRepository.save(kanban);
  }
}
