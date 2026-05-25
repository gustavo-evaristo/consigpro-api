import { Injectable } from '@nestjs/common';
import * as Boom from '@hapi/boom';
import { FormEntity } from 'src/domain/entities/form.entity';
import { IFormRepository } from 'src/domain/repositories/form.repository';

interface Input {
  token: string;
}

@Injectable()
export class GetPublicFormUseCase {
  constructor(private readonly formRepository: IFormRepository) {}

  async execute({ token }: Input): Promise<FormEntity> {
    const form = await this.formRepository.getByToken(token);

    if (!form) {
      throw Boom.notFound('Formulário não encontrado');
    }

    if (!form.isActive) {
      throw Boom.forbidden('Formulário não está disponível no momento', {
        code: 'FORM_INACTIVE',
      });
    }

    return form;
  }
}
