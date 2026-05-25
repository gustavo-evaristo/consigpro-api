import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SetFormActiveUseCase } from 'src/domain/use-cases';
import { JwtGuard } from 'src/infra/authentication/jwt.guard';
import { SetFormActiveDTO } from 'src/infra/dtos/form/set-form-active.dto';
import { FormResponse } from 'src/infra/responses/form/form.response';
import { serializeForm } from './form.serializer';

@ApiTags('Form')
@Controller('form')
export class SetFormActiveController {
  constructor(private readonly setFormActiveUseCase: SetFormActiveUseCase) {}

  @ApiOperation({ summary: 'Ativar ou desativar um formulário' })
  @ApiBody({ type: SetFormActiveDTO })
  @ApiOkResponse({ type: FormResponse })
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @Patch(':id/active')
  async setFormActive(
    @Param('id') id: string,
    @Body() body: SetFormActiveDTO,
    @Req() { user }: IReq,
  ) {
    const form = await this.setFormActiveUseCase.execute({
      formId: id,
      userId: user.id,
      isActive: body.isActive,
    });

    return serializeForm(form);
  }
}
