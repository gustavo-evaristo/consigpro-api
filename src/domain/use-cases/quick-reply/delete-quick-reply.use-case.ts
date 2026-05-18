import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { UUID } from 'src/domain/entities/vos';
import { IQuickReplyRepository } from 'src/domain/repositories/quick-reply.repository';

@Injectable()
export class DeleteQuickReplyUseCase {
  constructor(private readonly repo: IQuickReplyRepository) {}

  async execute({ userId, id }: { userId: string; id: string }) {
    const entity = await this.repo.getById(id);
    if (!entity) throw new NotFoundException('Resposta rápida não encontrada');
    if (!entity.belongsTo(UUID.from(userId))) throw new ForbiddenException();
    await this.repo.delete(id);
  }
}
