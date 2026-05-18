import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { IConversationRepository } from 'src/domain/repositories/conversation.repository';

interface Input {
  userId: string;
  conversationId: string;
}

@Injectable()
export class DeleteConversationUseCase {
  constructor(
    private readonly conversationRepository: IConversationRepository,
  ) {}

  async execute({ userId, conversationId }: Input): Promise<void> {
    const conversation =
      await this.conversationRepository.findById(conversationId);
    if (!conversation) throw new NotFoundException('Conversa não encontrada');
    if (conversation.flowUserId !== userId) throw new ForbiddenException();

    await this.conversationRepository.delete(conversationId);
  }
}
