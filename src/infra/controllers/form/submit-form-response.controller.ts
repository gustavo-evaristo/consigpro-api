import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SubmitFormResponseUseCase } from 'src/domain/use-cases';
import { SubmitFormResponseDTO } from 'src/infra/dtos/form/submit-form-response.dto';

@ApiTags('Form')
@Controller('form/public')
export class SubmitFormResponseController {
  constructor(
    private readonly submitFormResponseUseCase: SubmitFormResponseUseCase,
  ) {}

  @ApiOperation({ summary: 'Submit answers to a public Form' })
  @ApiBody({ type: SubmitFormResponseDTO })
  @ApiNoContentResponse()
  @Post(':token/submit')
  @HttpCode(204)
  async submitFormResponse(
    @Param('token') token: string,
    @Body()
    {
      answers,
      leadPhone,
      kanbanStageId,
      postFillKanbanStageId,
    }: SubmitFormResponseDTO,
  ) {
    await this.submitFormResponseUseCase.execute({
      token,
      answers,
      leadPhone,
      kanbanStageId,
      postFillKanbanStageId,
    });
  }
}
