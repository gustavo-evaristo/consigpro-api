import { UUID } from './vos';

export enum NodeType {
  TEXT = 'TEXT',
  QUESTION_MULTIPLE_CHOICE = 'QUESTION_MULTIPLE_CHOICE',
  QUESTION_FREE_INPUT = 'QUESTION_FREE_INPUT',
  END = 'END',
  FORM = 'FORM',
}

type FlowNodeEntityProps = {
  id?: string | UUID | null;
  flowId: string | UUID;
  kanbanStageId?: string | null;
  postFillKanbanStageId?: string | null;
  formId?: string | null;
  isDeleted?: boolean | null;
  type: NodeType;
  content: string;
  defaultNextNodeId?: string | null;
  x?: number | null;
  y?: number | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

export class FlowNodeEntity {
  id: UUID;
  flowId: UUID;
  kanbanStageId: string | null;
  postFillKanbanStageId: string | null;
  formId: string | null;
  isDeleted: boolean;
  type: NodeType;
  content: string;
  defaultNextNodeId: string | null;
  x: number;
  y: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: FlowNodeEntityProps) {
    if (props.id instanceof UUID) {
      this.id = props.id;
    } else if (typeof props.id === 'string') {
      this.id = UUID.from(props.id);
    } else {
      this.id = UUID.generate();
    }

    if (props.flowId instanceof UUID) {
      this.flowId = props.flowId;
    } else {
      this.flowId = UUID.from(props.flowId);
    }

    this.kanbanStageId = props.kanbanStageId ?? null;
    this.postFillKanbanStageId = props.postFillKanbanStageId ?? null;
    this.formId = props.formId ?? null;
    this.isDeleted = props.isDeleted ?? false;
    this.type = props.type;
    this.content = props.content;
    this.defaultNextNodeId = props.defaultNextNodeId ?? null;
    this.x = props.x ?? 0;
    this.y = props.y ?? 0;

    const createdAt = props.createdAt || new Date();
    this.createdAt = createdAt;
    this.updatedAt = props.updatedAt || createdAt;
  }

  private touch() {
    this.updatedAt = new Date();
  }

  isQuestion(): boolean {
    return (
      this.type === NodeType.QUESTION_MULTIPLE_CHOICE ||
      this.type === NodeType.QUESTION_FREE_INPUT
    );
  }

  isMultipleChoice(): boolean {
    return this.type === NodeType.QUESTION_MULTIPLE_CHOICE;
  }

  isEnd(): boolean {
    return this.type === NodeType.END;
  }

  update(props: {
    type: NodeType;
    content: string;
    defaultNextNodeId?: string | null;
    kanbanStageId?: string | null;
    postFillKanbanStageId?: string | null;
    formId?: string | null;
    x?: number;
    y?: number;
  }) {
    this.type = props.type;
    this.content = props.content;
    this.defaultNextNodeId = props.defaultNextNodeId ?? null;
    if (props.kanbanStageId !== undefined)
      this.kanbanStageId = props.kanbanStageId ?? null;
    if (props.postFillKanbanStageId !== undefined)
      this.postFillKanbanStageId = props.postFillKanbanStageId ?? null;
    if (props.formId !== undefined) this.formId = props.formId ?? null;
    if (props.x !== undefined) this.x = props.x;
    if (props.y !== undefined) this.y = props.y;
    this.touch();
  }

  delete() {
    this.isDeleted = true;
    this.touch();
  }
}
