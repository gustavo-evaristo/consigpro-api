import { Injectable } from '@nestjs/common';
import {
  IFormRepository,
  FormWithCount,
} from 'src/domain/repositories/form.repository';

interface Input {
  userId: string;
}

@Injectable()
export class ListFormsUseCase {
  constructor(private readonly formRepository: IFormRepository) {}

  async execute({ userId }: Input): Promise<FormWithCount[]> {
    return this.formRepository.findManyByUserId(userId);
  }
}
