import { Injectable } from '@nestjs/common';
import { startOfDay, endOfDay, subDays } from 'date-fns';
import { IAnalyticsRepository } from 'src/domain/repositories/analytics.repository';

interface Input {
  userId: string;
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class GetAnalyticsUseCase {
  constructor(private readonly analyticsRepository: IAnalyticsRepository) {}

  async execute({ userId, startDate, endDate }: Input) {
    const end = endDate ? endOfDay(endDate) : endOfDay(new Date());
    const start = startDate
      ? startOfDay(startDate)
      : startOfDay(subDays(new Date(), 6));
    return this.analyticsRepository.getAnalytics(userId, start, end);
  }
}
