import { Injectable } from '@nestjs/common';
import { FormEntity } from 'src/domain/entities/form.entity';
import {
  FormFieldEntity,
  FormFieldType,
} from 'src/domain/entities/form-field.entity';
import { FormFieldOptionEntity } from 'src/domain/entities/form-field-option.entity';
import { IFormRepository } from 'src/domain/repositories/form.repository';

interface FieldOptionInput {
  id?: string;
  label: string;
}

interface FieldInput {
  id?: string;
  type: FormFieldType;
  title?: string;
  label: string;
  placeholder?: string;
  required: boolean;
  options?: FieldOptionInput[];
  order: number;
}

interface Input {
  formId: string;
  userId: string;
  title: string;
  description?: string;
  fields: FieldInput[];
}

@Injectable()
export class UpdateFormUseCase {
  constructor(private readonly formRepository: IFormRepository) {}

  async execute({
    formId,
    userId,
    title,
    description,
    fields,
  }: Input): Promise<FormEntity> {
    const form = await this.formRepository.get(formId, userId);

    if (!form) {
      throw new Error('Form not found');
    }

    form.update({ title, description });

    form.fields = fields.map((f, i) => {
      const field = new FormFieldEntity({
        id: f.id,
        formId: form.id,
        type: f.type,
        title: f.title,
        label: f.label,
        placeholder: f.placeholder,
        required: f.required,
        order: i,
      });

      field.options = (f.options ?? []).map(
        (o, oi) =>
          new FormFieldOptionEntity({
            id: o.id,
            fieldId: field.id,
            label: o.label,
            order: oi,
          }),
      );

      return field;
    });

    await this.formRepository.update(form);
    await this.formRepository.saveFieldsAndOptions(form);

    return form;
  }
}
