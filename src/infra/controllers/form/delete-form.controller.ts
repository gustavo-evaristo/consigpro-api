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
import { DeleteFormUseCase } from 'src/domain/use-cases';
import { JwtGuard } from 'src/infra/authentication/jwt.guard';

@ApiTags('Form')
@Controller('form')
export class DeleteFormController {
  constructor(private readonly deleteFormUseCase: DeleteFormUseCase) {}

  @ApiOperation({ summary: 'Delete a Form' })
  @ApiNoContentResponse()
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @Delete(':id')
  @HttpCode(204)
  async deleteForm(@Param('id') id: string, @Req() { user }: IReq) {
    await this.deleteFormUseCase.execute({ formId: id, userId: user.id });
  }
}
