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
import { DeleteFormResponseUseCase } from 'src/domain/use-cases';
import { JwtGuard } from 'src/infra/authentication/jwt.guard';

@ApiTags('Form')
@Controller('form')
export class DeleteFormResponseController {
  constructor(
    private readonly deleteFormResponseUseCase: DeleteFormResponseUseCase,
  ) {}

  @ApiOperation({ summary: 'Delete a Form Response' })
  @ApiNoContentResponse()
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @Delete(':id/responses/:responseId')
  @HttpCode(204)
  async deleteFormResponse(
    @Param('id') id: string,
    @Param('responseId') responseId: string,
    @Req() { user }: IReq,
  ) {
    await this.deleteFormResponseUseCase.execute({
      formId: id,
      responseId,
      userId: user.id,
    });
  }
}
