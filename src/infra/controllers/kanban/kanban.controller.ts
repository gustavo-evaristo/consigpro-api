import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from 'src/infra/authentication/jwt.guard';
import {
  CreateKanbanDto,
  UpdateKanbanDto,
  CreateKanbanStageDto,
  UpdateKanbanStageDto,
  MoveLeadStageDto,
  ReorderKanbanStagesDto,
} from 'src/infra/dtos/kanban/kanban.dto';
import { CreateKanbanUseCase } from 'src/domain/use-cases/kanban/create-kanban.use-case';
import { UpdateKanbanUseCase } from 'src/domain/use-cases/kanban/update-kanban.use-case';
import { DeleteKanbanUseCase } from 'src/domain/use-cases/kanban/delete-kanban.use-case';
import { ListKanbansUseCase } from 'src/domain/use-cases/kanban/list-kanbans.use-case';
import { GetKanbanBoardUseCase } from 'src/domain/use-cases/kanban/get-kanban-board.use-case';
import { CreateKanbanStageUseCase } from 'src/domain/use-cases/kanban/create-kanban-stage.use-case';
import { UpdateKanbanStageUseCase } from 'src/domain/use-cases/kanban/update-kanban-stage.use-case';
import { DeleteKanbanStageUseCase } from 'src/domain/use-cases/kanban/delete-kanban-stage.use-case';
import { ListKanbanStagesUseCase } from 'src/domain/use-cases/kanban/list-kanban-stages.use-case';
import { MoveLeadStageUseCase } from 'src/domain/use-cases/kanban/move-lead-stage.use-case';
import { ReorderKanbanStagesUseCase } from 'src/domain/use-cases/kanban/reorder-kanban-stages.use-case';

@ApiTags('Kanbans')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('kanbans')
export class KanbanController {
  constructor(
    private readonly createKanban: CreateKanbanUseCase,
    private readonly updateKanban: UpdateKanbanUseCase,
    private readonly deleteKanban: DeleteKanbanUseCase,
    private readonly listKanbans: ListKanbansUseCase,
    private readonly getKanbanBoard: GetKanbanBoardUseCase,
    private readonly createStage: CreateKanbanStageUseCase,
    private readonly updateStage: UpdateKanbanStageUseCase,
    private readonly deleteStage: DeleteKanbanStageUseCase,
    private readonly listStages: ListKanbanStagesUseCase,
    private readonly moveLeadStageUseCase: MoveLeadStageUseCase,
    private readonly reorderStages: ReorderKanbanStagesUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List kanbans with stats' })
  async list(@Req() { user }: IReq) {
    const kanbans = await this.listKanbans.execute({ userId: user.id });
    return kanbans.map((k) => ({
      id: k.id,
      title: k.title,
      description: k.description,
      stagesCount: k.stagesCount,
      activeLeadsCount: k.activeLeadsCount,
      linkedFlowTitle: k.linkedFlowTitle,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
    }));
  }

  @Post()
  @ApiOperation({ summary: 'Create kanban with optional initial stages' })
  async create(@Body() body: CreateKanbanDto, @Req() { user }: IReq) {
    return this.createKanban.execute({
      userId: user.id,
      title: body.title,
      description: body.description,
      stages: body.stages,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update kanban' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateKanbanDto,
    @Req() { user }: IReq,
  ) {
    await this.updateKanban.execute({ userId: user.id, kanbanId: id, ...body });
    return { status: 'ok' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete kanban' })
  async remove(@Param('id') id: string, @Req() { user }: IReq) {
    await this.deleteKanban.execute({ userId: user.id, kanbanId: id });
    return { status: 'ok' };
  }

  @Get(':id/board')
  @ApiOperation({ summary: 'Get kanban board with lead cards per stage' })
  async board(@Param('id') id: string, @Req() { user }: IReq) {
    return this.getKanbanBoard.execute({ userId: user.id, kanbanId: id });
  }

  @Get(':id/stages')
  @ApiOperation({ summary: 'List kanban stages' })
  async stages(@Param('id') id: string, @Req() { user }: IReq) {
    const stages = await this.listStages.execute({
      userId: user.id,
      kanbanId: id,
    });
    return stages.map((s) => ({
      id: s.id.toString(),
      kanbanId: s.kanbanId.toString(),
      title: s.title,
      color: s.color,
      order: s.order,
    }));
  }

  @Post(':id/stages')
  @ApiOperation({ summary: 'Create kanban stage' })
  async createStageHandler(
    @Param('id') id: string,
    @Body() body: CreateKanbanStageDto,
    @Req() { user }: IReq,
  ) {
    return this.createStage.execute({ userId: user.id, kanbanId: id, ...body });
  }

  @Patch(':id/stages/reorder')
  @ApiOperation({ summary: 'Reorder kanban stages' })
  async reorderStagesHandler(
    @Param('id') id: string,
    @Body() body: ReorderKanbanStagesDto,
    @Req() { user }: IReq,
  ) {
    await this.reorderStages.execute({
      userId: user.id,
      kanbanId: id,
      stageIds: body.stageIds,
    });
    return { status: 'ok' };
  }

  @Patch(':id/stages/:stageId')
  @ApiOperation({ summary: 'Update kanban stage' })
  async updateStageHandler(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() body: UpdateKanbanStageDto,
    @Req() { user }: IReq,
  ) {
    await this.updateStage.execute({
      userId: user.id,
      kanbanId: id,
      stageId,
      ...body,
    });
    return { status: 'ok' };
  }

  @Delete(':id/stages/:stageId')
  @ApiOperation({ summary: 'Delete kanban stage' })
  async deleteStageHandler(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Req() { user }: IReq,
  ) {
    await this.deleteStage.execute({ userId: user.id, kanbanId: id, stageId });
    return { status: 'ok' };
  }

  @Patch(':id/leads/:conversationId/stage')
  @ApiOperation({ summary: 'Move lead to a different kanban stage' })
  async moveLeadStageHandler(
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
    @Body() body: MoveLeadStageDto,
    @Req() { user }: IReq,
  ) {
    await this.moveLeadStageUseCase.execute({
      userId: user.id,
      kanbanId: id,
      conversationId,
      targetStageId: body.targetStageId,
    });
    return { status: 'ok' };
  }
}
