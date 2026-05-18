import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class AnswerDTO {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'field-uuid' })
  fieldId: string;

  @ApiProperty({ example: 'Resposta do usuário' })
  value: string | string[];
}

export class SubmitFormResponseDTO {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDTO)
  @ApiProperty({ type: [AnswerDTO] })
  answers: AnswerDTO[];

  @ApiPropertyOptional({ example: '5511999999999' })
  @IsOptional()
  @IsString()
  leadPhone?: string;

  @ApiPropertyOptional({ example: 'kanban-stage-uuid' })
  @IsOptional()
  @IsUUID()
  kanbanStageId?: string;

  @ApiPropertyOptional({ example: 'kanban-stage-uuid' })
  @IsOptional()
  @IsUUID()
  postFillKanbanStageId?: string;
}
