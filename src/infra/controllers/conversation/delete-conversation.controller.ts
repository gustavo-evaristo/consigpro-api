import {
  Controller,
  Delete,
  HttpCode,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from 'src/infra/authentication/jwt.guard';
import { DeleteConversationUseCase } from 'src/domain/use-cases/conversation/delete-conversation.use-case';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('conversations')
export class DeleteConversationController {
  constructor(private readonly deleteConversation: DeleteConversationUseCase) {}

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Soft-delete a conversation and remove the lead from all views',
  })
  @ApiNoContentResponse()
  async delete(@Param('id') id: string, @Req() { user }: IReq) {
    await this.deleteConversation.execute({
      userId: user.id,
      conversationId: id,
    });
  }
}
