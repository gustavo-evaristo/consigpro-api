import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DuplicateFlowUseCase } from 'src/domain/use-cases/flow/duplicate-flow.use-case';
import { JwtGuard } from 'src/infra/authentication/jwt.guard';

class DuplicateFlowResponse {
  id: string;
}

@ApiTags('Flow')
@Controller('flow')
export class DuplicateFlowController {
  constructor(private readonly duplicateFlowUseCase: DuplicateFlowUseCase) {}

  @ApiOperation({ summary: 'Duplicate a flow with all its nodes' })
  @ApiOkResponse({ type: DuplicateFlowResponse })
  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Post(':id/duplicate')
  async duplicate(@Req() { user }: IReq, @Param('id') id: string) {
    return this.duplicateFlowUseCase.execute({ flowId: id, userId: user.id });
  }
}
