import { Injectable } from '@nestjs/common';
import { subDays } from 'date-fns';
import {
  AnalyticsV2Result,
  IAnalyticsV2Repository,
  WhatsappSessionStatus,
} from 'src/domain/repositories/analytics-v2.repository';

// Brazil never observes DST (abolished in 2019), so UTC-3 is constant.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

// Converts a date parsed as UTC midnight ("2026-05-13T00:00:00Z") into the
// UTC timestamp that represents midnight in BRT (2026-05-13T03:00:00Z).
function brtStartOfDay(d: Date): Date {
  return new Date(d.getTime() + BRT_OFFSET_MS);
}

// End of the same BRT day (one millisecond before the next BRT midnight).
function brtEndOfDay(d: Date): Date {
  return new Date(brtStartOfDay(d).getTime() + 24 * 60 * 60 * 1000 - 1);
}

interface Input {
  userId: string;
  startDate?: Date;
  endDate?: Date;
  kanbanId?: string;
  flowId?: string;
}

@Injectable()
export class GetAnalyticsV2UseCase {
  constructor(private readonly analyticsV2Repository: IAnalyticsV2Repository) {}

  async execute({
    userId,
    startDate,
    endDate,
    kanbanId,
    flowId,
  }: Input): Promise<AnalyticsV2Result> {
    const end = endDate ? brtEndOfDay(endDate) : brtEndOfDay(new Date());
    const start = startDate
      ? brtStartOfDay(startDate)
      : brtStartOfDay(subDays(new Date(), 13));

    const result = await this.analyticsV2Repository.getAnalyticsV2(
      userId,
      start,
      end,
      kanbanId,
      flowId,
    );

    return {
      ...result,
      whatsappSessions: result.whatsappSessions.map((s) => ({
        ...s,
        status: deriveStatus(s.isActive, s.phone),
      })),
    };
  }
}

function deriveStatus(
  isActive: boolean,
  phone: string | null,
): WhatsappSessionStatus {
  // flow.isActive é mantido pelo whatsapp.service: vira true quando baileys
  // conecta com o número certo, e false quando a sessão cai. Se estiver true,
  // o fluxo está efetivamente recebendo mensagens.
  if (isActive) return 'connected';
  if (!phone) return 'pending';
  return 'disconnected';
}
