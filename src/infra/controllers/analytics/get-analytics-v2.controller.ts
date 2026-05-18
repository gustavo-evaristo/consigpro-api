import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GetAnalyticsV2UseCase } from 'src/domain/use-cases/analytics/get-analytics-v2.use-case';
import { JwtGuard } from 'src/infra/authentication/jwt.guard';
import { GetAnalyticsV2QueryDto } from 'src/infra/dtos/analytics/get-analytics-v2.dto';
import { GetAnalyticsV2Response } from 'src/infra/responses/analytics/get-analytics-v2.response';

@ApiTags('Analytics')
@Controller('v2/analytics')
export class GetAnalyticsV2Controller {
  constructor(private readonly getAnalyticsV2UseCase: GetAnalyticsV2UseCase) {}

  @Get()
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get dashboard analytics v2 (new layout) for the authenticated user',
  })
  @ApiOkResponse({ type: GetAnalyticsV2Response })
  async getAnalyticsV2(
    @Req() { user }: IReq,
    @Query() query: GetAnalyticsV2QueryDto,
  ) {
    return this.getAnalyticsV2UseCase.execute({
      userId: user.id,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      kanbanId: query.kanbanId,
      flowId: query.flowId,
    });
  }
}
