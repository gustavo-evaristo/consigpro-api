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
import { IsNotEmpty, IsString } from 'class-validator';
import { JwtGuard } from 'src/infra/authentication/jwt.guard';
import { ListQuickRepliesUseCase } from 'src/domain/use-cases/quick-reply/list-quick-replies.use-case';
import { CreateQuickReplyUseCase } from 'src/domain/use-cases/quick-reply/create-quick-reply.use-case';
import { UpdateQuickReplyUseCase } from 'src/domain/use-cases/quick-reply/update-quick-reply.use-case';
import { DeleteQuickReplyUseCase } from 'src/domain/use-cases/quick-reply/delete-quick-reply.use-case';

class QuickReplyDto {
  @IsString()
  @IsNotEmpty()
  shortcut: string;

  @IsString()
  @IsNotEmpty()
  content: string;
}

@ApiTags('Quick Replies')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('quick-replies')
export class QuickReplyController {
  constructor(
    private readonly list: ListQuickRepliesUseCase,
    private readonly create: CreateQuickReplyUseCase,
    private readonly update: UpdateQuickReplyUseCase,
    private readonly remove: DeleteQuickReplyUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List quick replies' })
  async listAll(@Req() { user }: IReq) {
    const items = await this.list.execute({ userId: user.id });
    return items.map((r) => ({
      id: r.id.toString(),
      shortcut: r.shortcut,
      content: r.content,
      createdAt: r.createdAt,
    }));
  }

  @Post()
  @ApiOperation({ summary: 'Create quick reply' })
  async createOne(@Body() body: QuickReplyDto, @Req() { user }: IReq) {
    return this.create.execute({ userId: user.id, ...body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update quick reply' })
  async updateOne(
    @Param('id') id: string,
    @Body() body: QuickReplyDto,
    @Req() { user }: IReq,
  ) {
    await this.update.execute({ userId: user.id, id, ...body });
    return { status: 'ok' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete quick reply' })
  async deleteOne(@Param('id') id: string, @Req() { user }: IReq) {
    await this.remove.execute({ userId: user.id, id });
    return { status: 'ok' };
  }
}
