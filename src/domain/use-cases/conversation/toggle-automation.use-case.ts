import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { IConversationRepository } from 'src/domain/repositories/conversation.repository';

interface Input {
  userId: string;
  conversationId: string;
  enabled: boolean;
}

@Injectable()
export class ToggleAutomationUseCase {
  constructor(
    private readonly conversationRepository: IConversationRepository,
  ) {}

  async execute({ userId, conversationId, enabled }: Input): Promise<void> {
    const conversation =
      await this.conversationRepository.findById(conversationId);
    if (!conversation) throw new NotFoundException('Conversa não encontrada');
    if (conversation.flowUserId !== userId) throw new ForbiddenException();

    const entity = await this.conversationRepository.findActive(
      conversation.flowId,
      conversation.leadPhoneNumber,
    );

    const target =
      entity ??
      (await this.conversationRepository.findByIdAsEntity(conversationId));

    if (!target) throw new NotFoundException('Conversa não encontrada');

    if (enabled) {
      target.enableAutomation();
    } else {
      target.disableAutomation();
    }

    await this.conversationRepository.update(target);
  }
}
