import { Injectable } from '@nestjs/common';
import { FlowEntity } from 'src/domain/entities/flow.entity';
import { IFlowRepository, IUserRepository } from 'src/domain/repositories';

interface Input {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  kanbanId?: string | null;
}

@Injectable()
export class UpdateFlowUseCase {
  constructor(
    private readonly flowRepository: IFlowRepository,
    private readonly userRepository: IUserRepository,
  ) {}

  async execute({
    id,
    userId,
    title,
    description,
    kanbanId,
  }: Input): Promise<FlowEntity> {
    const user = await this.userRepository.get(userId);

    if (!user) {
      throw new Error('User not found');
    }

    const flow = await this.flowRepository.get(id);

    if (!flow) {
      throw new Error('Flow not found');
    }

    if (!flow.belongsTo(user.id)) {
      throw new Error('User does not own this flow');
    }

    flow.update({ title, description, kanbanId });

    await this.flowRepository.update(flow);

    return flow;
  }
}
