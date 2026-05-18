import { UUID } from './vos';
import { FormFieldEntity } from './form-field.entity';
import { randomUUID } from 'crypto';

interface FormEntityProps {
  id?: string | UUID | null;
  userId: string | UUID;
  title: string;
  description?: string | null;
  token?: string | null;
  isActive?: boolean | null;
  isDeleted?: boolean | null;
  fields?: FormFieldEntity[];
  responsesCount?: number;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

interface UpdateFormEntityProps {
  title: string;
  description?: string | null;
}

export class FormEntity {
  id: UUID;
  userId: UUID;
  title: string;
  description: string | null;
  token: string;
  isActive: boolean;
  isDeleted: boolean;
  fields: FormFieldEntity[];
  responsesCount: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: FormEntityProps) {
    if (props.id instanceof UUID) {
      this.id = props.id;
    } else if (typeof props.id === 'string') {
      this.id = UUID.from(props.id);
    } else {
      this.id = UUID.generate();
    }

    this.userId =
      props.userId instanceof UUID ? props.userId : UUID.from(props.userId);

    this.title = props.title;
    this.description = props.description ?? null;
    this.token = props.token ?? randomUUID();
    this.isActive = props.isActive ?? false;
    this.isDeleted = props.isDeleted ?? false;
    this.fields = props.fields ?? [];
    this.responsesCount = props.responsesCount ?? 0;

    const now = new Date();
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;
  }

  private touch() {
    this.updatedAt = new Date();
  }

  update({ title, description }: UpdateFormEntityProps) {
    this.title = title;
    this.description = description ?? null;
    this.touch();
  }

  delete() {
    this.isDeleted = true;
    this.touch();
  }

  belongsTo(userId: UUID): boolean {
    return this.userId.equals(userId);
  }
}
