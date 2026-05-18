import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { UUID } from 'src/domain/entities/vos';
import { IQuickReplyRepository } from 'src/domain/repositories/quick-reply.repository';

interface Input {
  userId: string;
  id: string;
  shortcut: string;
  content: string;
}

@Injectable()
export class UpdateQuickReplyUseCase {
  constructor(private readonly repo: IQuickReplyRepository) {}

  async execute({ userId, id, shortcut, content }: Input) {
    const entity = await this.repo.getById(id);
    if (!entity) throw new NotFoundException('Resposta rápida não encontrada');
    if (!entity.belongsTo(UUID.from(userId))) throw new ForbiddenException();
    entity.update(shortcut, content);
    await this.repo.save(entity);
  }
}
