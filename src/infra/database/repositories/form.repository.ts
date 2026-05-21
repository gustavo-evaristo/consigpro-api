import { Injectable } from '@nestjs/common';
import {
  IFormRepository,
  FormWithCount,
  FormResponseDetail,
} from 'src/domain/repositories/form.repository';
import { FormEntity } from 'src/domain/entities/form.entity';
import { FormFieldEntity } from 'src/domain/entities/form-field.entity';
import { FormFieldOptionEntity } from 'src/domain/entities/form-field-option.entity';
import { UUID } from 'src/domain/entities/vos';
import { PrismaService } from '../prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class FormRepository implements IFormRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async create(form: FormEntity): Promise<void> {
    await this.prismaService.forms.create({
      data: {
        id: form.id.toString(),
        userId: form.userId.toString(),
        title: form.title,
        description: form.description,
        token: form.token,
        isActive: form.isActive,
        isDeleted: form.isDeleted,
        createdAt: form.createdAt,
        updatedAt: form.updatedAt,
      },
    });
  }

  async get(id: string, userId: string): Promise<FormEntity | null> {
    const record = await this.prismaService.forms.findFirst({
      where: { id, userId, isDeleted: false },
      include: {
        fields: {
          where: { isDeleted: false },
          orderBy: { order: 'asc' },
          include: {
            options: {
              where: { isDeleted: false },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    if (!record) return null;

    return this.toEntity(record);
  }

  async getByIdInternal(id: string): Promise<FormEntity | null> {
    const record = await this.prismaService.forms.findFirst({
      where: { id, isDeleted: false },
      include: {
        fields: {
          where: { isDeleted: false },
          orderBy: { order: 'asc' },
          include: {
            options: {
              where: { isDeleted: false },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    if (!record) return null;

    return this.toEntity(record);
  }

  async getByToken(token: string): Promise<FormEntity | null> {
    const record = await this.prismaService.forms.findFirst({
      where: { token, isDeleted: false },
      include: {
        fields: {
          where: { isDeleted: false },
          orderBy: { order: 'asc' },
          include: {
            options: {
              where: { isDeleted: false },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    if (!record) return null;

    return this.toEntity(record);
  }

  async update(form: FormEntity): Promise<void> {
    await this.prismaService.forms.update({
      where: { id: form.id.toString() },
      data: {
        title: form.title,
        description: form.description,
        isActive: form.isActive,
        isDeleted: form.isDeleted,
        updatedAt: form.updatedAt,
      },
    });
  }

  async findManyByUserId(userId: string): Promise<FormWithCount[]> {
    // Em uma chamada: form + fields + options + count + última resposta.
    // O `take: 1` na relação responses pega apenas o timestamp mais recente.
    const records = await this.prismaService.forms.findMany({
      where: { userId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      include: {
        fields: {
          where: { isDeleted: false },
          orderBy: { order: 'asc' },
          include: {
            options: {
              where: { isDeleted: false },
              orderBy: { order: 'asc' },
            },
          },
        },
        _count: { select: { responses: { where: { isDeleted: false } } } },
        responses: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    return records.map((r) => {
      const entity = this.toEntity(r) as FormWithCount;
      entity.responsesCount = r._count.responses;
      entity.lastResponseAt = r.responses[0]?.createdAt ?? null;
      return entity;
    });
  }

  async delete(form: FormEntity): Promise<void> {
    await this.prismaService.forms.update({
      where: { id: form.id.toString() },
      data: { isDeleted: true, updatedAt: form.updatedAt },
    });
  }

  async saveFieldsAndOptions(form: FormEntity): Promise<void> {
    const formId = form.id.toString();

    await this.prismaService.$transaction(async (tx) => {
      const incomingFieldIds = form.fields
        .filter((f) => !f.id.toString().startsWith('new_'))
        .map((f) => f.id.toString());

      // Soft-delete fields no longer present
      await tx.form_fields.updateMany({
        where: { formId, isDeleted: false, id: { notIn: incomingFieldIds } },
        data: { isDeleted: true, updatedAt: new Date() },
      });

      for (const field of form.fields) {
        const fieldId = field.id.toString();

        await tx.form_fields.upsert({
          where: { id: fieldId },
          create: {
            id: fieldId,
            formId,
            type: field.type,
            title: field.title,
            label: field.label,
            placeholder: field.placeholder,
            required: field.required,
            order: field.order,
            isDeleted: false,
          },
          update: {
            type: field.type,
            title: field.title,
            label: field.label,
            placeholder: field.placeholder,
            required: field.required,
            order: field.order,
            isDeleted: false,
            updatedAt: new Date(),
          },
        });

        const incomingOptionIds = field.options
          .filter((o) => !o.id.toString().startsWith('new_'))
          .map((o) => o.id.toString());

        // Soft-delete options no longer present
        await tx.form_field_options.updateMany({
          where: {
            fieldId,
            isDeleted: false,
            id: { notIn: incomingOptionIds },
          },
          data: { isDeleted: true, updatedAt: new Date() },
        });

        for (const option of field.options) {
          const optionId = option.id.toString();

          await tx.form_field_options.upsert({
            where: { id: optionId },
            create: {
              id: optionId,
              fieldId,
              label: option.label,
              order: option.order,
              isDeleted: false,
            },
            update: {
              label: option.label,
              order: option.order,
              isDeleted: false,
              updatedAt: new Date(),
            },
          });
        }
      }
    });
  }

  async listResponses(
    formId: string,
    userId: string,
  ): Promise<FormResponseDetail[]> {
    const form = await this.prismaService.forms.findFirst({
      where: { id: formId, userId, isDeleted: false },
    });

    if (!form) return [];

    const responses = await this.prismaService.form_responses.findMany({
      where: { formId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      include: {
        answers: {
          include: {
            field: {
              select: { label: true, type: true, isDeleted: true, order: true },
            },
          },
        },
      },
    });

    return responses.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      answers: r.answers
        .filter((a) => !a.field.isDeleted)
        .sort((a, b) => a.field.order - b.field.order)
        .map((a) => ({
          fieldId: a.fieldId,
          fieldLabel: a.field.label,
          fieldType: a.field.type,
          value: a.value,
        })),
    }));
  }

  async deleteResponse(responseId: string): Promise<void> {
    await this.prismaService.form_responses.update({
      where: { id: responseId },
      data: { isDeleted: true },
    });
  }

  async saveResponse(
    formId: string,
    answers: { fieldId: string; value: string }[],
  ): Promise<void> {
    const responseId = randomUUID();

    await this.prismaService.form_responses.create({
      data: {
        id: responseId,
        formId,
        answers: {
          create: answers.map((a) => ({
            id: randomUUID(),
            fieldId: a.fieldId,
            value: a.value,
          })),
        },
      },
    });
  }

  private toEntity(record: any): FormEntity {
    const fields: FormFieldEntity[] = (record.fields ?? []).map((f: any) => {
      const options: FormFieldOptionEntity[] = (f.options ?? []).map(
        (o: any) =>
          new FormFieldOptionEntity({
            id: UUID.from(o.id),
            fieldId: UUID.from(f.id),
            isDeleted: o.isDeleted,
            label: o.label,
            order: o.order,
            createdAt: o.createdAt,
            updatedAt: o.updatedAt,
          }),
      );

      return new FormFieldEntity({
        id: UUID.from(f.id),
        formId: UUID.from(record.id),
        isDeleted: f.isDeleted,
        type: f.type,
        title: f.title,
        label: f.label,
        placeholder: f.placeholder,
        required: f.required,
        order: f.order,
        options,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      });
    });

    return new FormEntity({
      id: UUID.from(record.id),
      userId: UUID.from(record.userId),
      title: record.title,
      description: record.description,
      token: record.token,
      isActive: record.isActive,
      isDeleted: record.isDeleted,
      fields,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
