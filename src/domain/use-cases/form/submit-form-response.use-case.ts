import { Injectable } from '@nestjs/common';
import { IFormRepository } from 'src/domain/repositories/form.repository';
import { IConversationRepository } from 'src/domain/repositories/conversation.repository';
import { IConversationProgressRepository } from 'src/domain/repositories/conversation-progress.repository';

interface AnswerInput {
  fieldId: string;
  value: string | string[];
}

interface Input {
  token: string;
  answers: AnswerInput[];
  leadPhone?: string;
  kanbanStageId?: string;
  postFillKanbanStageId?: string;
}

@Injectable()
export class SubmitFormResponseUseCase {
  constructor(
    private readonly formRepository: IFormRepository,
    private readonly conversationRepository: IConversationRepository,
    private readonly conversationProgressRepository: IConversationProgressRepository,
  ) {}

  async execute({
    token,
    answers,
    leadPhone,
    kanbanStageId,
    postFillKanbanStageId,
  }: Input): Promise<void> {
    const form = await this.formRepository.getByToken(token);

    if (!form) {
      throw new Error('Form not found');
    }

    const normalizedAnswers = answers.map((a) => ({
      fieldId: a.fieldId,
      value: Array.isArray(a.value) ? a.value.join(', ') : a.value,
    }));

    await this.formRepository.saveResponse(
      form.id.toString(),
      normalizedAnswers,
    );

    const stageToRecord = postFillKanbanStageId ?? kanbanStageId;
    if (leadPhone && stageToRecord) {
      const conversation = await this.conversationRepository.findByLeadPhone(
        form.userId.toString(),
        leadPhone,
      );

      if (conversation) {
        const progress =
          await this.conversationProgressRepository.findByConversationId(
            conversation.id.toString(),
          );

        if (progress) {
          progress.recordKanbanStage(stageToRecord);
          await this.conversationProgressRepository.update(progress);
        }
      }
    }
  }
}
