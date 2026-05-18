import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { JwtGuard } from 'src/infra/authentication/jwt.guard';
import { ToggleAutomationUseCase } from 'src/domain/use-cases/conversation/toggle-automation.use-case';

class ToggleAutomationDto {
  @IsBoolean()
  enabled: boolean;
}

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('conversations')
export class ToggleAutomationController {
  constructor(private readonly toggleAutomation: ToggleAutomationUseCase) {}

  @Patch(':id/automation')
  @ApiOperation({
    summary: 'Enable or disable bot automation for a conversation',
  })
  async toggle(
    @Param('id') id: string,
    @Body() body: ToggleAutomationDto,
    @Req() { user }: IReq,
  ) {
    await this.toggleAutomation.execute({
      userId: user.id,
      conversationId: id,
      enabled: body.enabled,
    });
    return { status: 'ok' };
  }
}
