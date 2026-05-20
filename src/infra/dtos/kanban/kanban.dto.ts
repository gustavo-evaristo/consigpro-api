import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateKanbanDto {
  @ApiProperty({ example: 'Pipeline de Vendas' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Acompanhamento de leads' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: ['Novo', 'Em contato', 'Proposta', 'Fechado'],
    isArray: true,
    type: String,
    description:
      'Estágios iniciais (em ordem). O backend cria todos atomicamente.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  stages?: string[];
}

export class UpdateKanbanDto {
  @ApiProperty({ example: 'Pipeline de Vendas' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Acompanhamento de leads' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateKanbanStageDto {
  @ApiProperty({ example: 'Dados Básicos' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: '#3B82F6' })
  @IsOptional()
  @IsString()
  color?: string;
}

export class UpdateKanbanStageDto {
  @ApiProperty({ example: 'Dados Básicos' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: '#3B82F6' })
  @IsOptional()
  @IsString()
  color?: string;
}

export class DeleteKanbanStageDto {
  @ApiPropertyOptional({
    description:
      'ID da coluna de destino para onde os leads/nós de fluxo serão movidos. Obrigatório se a coluna excluída tiver leads ou nós vinculados.',
  })
  @IsOptional()
  @IsString()
  targetStageId?: string;
}

export class MoveLeadStageDto {
  @ApiProperty({ description: 'ID do estágio de destino' })
  @IsString()
  @IsNotEmpty()
  targetStageId: string;
}

export class ReorderKanbanStagesDto {
  @ApiProperty({
    description: 'IDs dos estágios na nova ordem (todos os estágios do kanban)',
    isArray: true,
    type: String,
  })
  @IsArray()
  @IsString({ each: true })
  stageIds: string[];
}
