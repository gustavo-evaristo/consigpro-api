import { UUID } from './vos';

interface FormFieldOptionEntityProps {
  id?: string | UUID | null;
  fieldId: string | UUID;
  isDeleted?: boolean | null;
  label: string;
  order?: number;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export class FormFieldOptionEntity {
  id: UUID;
  fieldId: UUID;
  isDeleted: boolean;
  label: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: FormFieldOptionEntityProps) {
    if (props.id instanceof UUID) {
      this.id = props.id;
    } else if (typeof props.id === 'string') {
      this.id = UUID.from(props.id);
    } else {
      this.id = UUID.generate();
    }

    this.fieldId =
      props.fieldId instanceof UUID ? props.fieldId : UUID.from(props.fieldId);

    this.isDeleted = props.isDeleted ?? false;
    this.label = props.label;
    this.order = props.order ?? 0;

    const now = new Date();
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;
  }
}
