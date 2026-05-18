import { Injectable } from '@nestjs/common';
import {
  AnalyticsResult,
  IAnalyticsRepository,
} from 'src/domain/repositories/analytics.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AnalyticsRepository implements IAnalyticsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async getAnalytics(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<AnalyticsResult> {
    type BigIntRow = { count: bigint };

    const [todayMsgsRow] = await this.prismaService.$queryRaw<BigIntRow[]>`
      SELECT COUNT(mh.id)::bigint AS count
      FROM flows k
      JOIN conversations c ON c."flowId" = k.id
      JOIN message_history mh ON mh."conversationId" = c.id
      WHERE k."userId" = ${userId}
        AND k."isDeleted" = false
        AND mh.sender = 'LEAD'
        AND mh."createdAt" >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
    `;

    const [todayLeadsRow] = await this.prismaService.$queryRaw<BigIntRow[]>`
      SELECT COUNT(c.id)::bigint AS count
      FROM flows k
      JOIN conversations c ON c."flowId" = k.id
      WHERE k."userId" = ${userId}
        AND k."isDeleted" = false
        AND c."createdAt" >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
    `;

    type CountsRow = { totalLeads: bigint; totalInteractions: bigint };

    const [counts] = await this.prismaService.$queryRaw<CountsRow[]>`
      SELECT
        COUNT(DISTINCT c.id)::bigint AS "totalLeads",
        COUNT(mh.id) FILTER (WHERE mh.sender = 'BOT')::bigint AS "totalInteractions"
      FROM flows k
      JOIN conversations c ON c."flowId" = k.id
      LEFT JOIN message_history mh ON mh."conversationId" = c.id
      WHERE k."userId" = ${userId}
        AND k."isDeleted" = false
        AND c."createdAt" BETWEEN ${startDate} AND ${endDate}
    `;

    type DateRow = { date: string; count: bigint };

    const leadsByDateRows = await this.prismaService.$queryRaw<DateRow[]>`
      SELECT
        TO_CHAR(c."createdAt", 'DD/MM') AS date,
        COUNT(*)::bigint AS count
      FROM flows k
      JOIN conversations c ON c."flowId" = k.id
      WHERE k."userId" = ${userId}
        AND k."isDeleted" = false
        AND c."createdAt" BETWEEN ${startDate} AND ${endDate}
      GROUP BY TO_CHAR(c."createdAt", 'DD/MM'), DATE_TRUNC('day', c."createdAt")
      ORDER BY DATE_TRUNC('day', c."createdAt")
    `;

    const messagesByDayRows = await this.prismaService.$queryRaw<DateRow[]>`
      SELECT
        TO_CHAR(mh."createdAt", 'DD/MM') AS date,
        COUNT(*)::bigint AS count
      FROM flows k
      JOIN conversations c ON c."flowId" = k.id
      JOIN message_history mh ON mh."conversationId" = c.id
      WHERE k."userId" = ${userId}
        AND k."isDeleted" = false
        AND mh."createdAt" BETWEEN ${startDate} AND ${endDate}
      GROUP BY TO_CHAR(mh."createdAt", 'DD/MM'), DATE_TRUNC('day', mh."createdAt")
      ORDER BY DATE_TRUNC('day', mh."createdAt")
    `;

    type StatusRow = { status: string; count: bigint };

    const statusRows = await this.prismaService.$queryRaw<StatusRow[]>`
      SELECT c.status, COUNT(*)::bigint AS count
      FROM flows k
      JOIN conversations c ON c."flowId" = k.id
      WHERE k."userId" = ${userId}
        AND k."isDeleted" = false
        AND c."createdAt" BETWEEN ${startDate} AND ${endDate}
      GROUP BY c.status
    `;

    type FlowRow = { flow: string; count: bigint };

    const flowRows = await this.prismaService.$queryRaw<FlowRow[]>`
      SELECT k.title AS flow, COUNT(c.id)::bigint AS count
      FROM flows k
      JOIN conversations c ON c."flowId" = k.id
      WHERE k."userId" = ${userId}
        AND k."isDeleted" = false
        AND c."createdAt" BETWEEN ${startDate} AND ${endDate}
      GROUP BY k.title
      ORDER BY count DESC
    `;

    type HourRow = { hour: number; count: bigint };

    const hourRows = await this.prismaService.$queryRaw<HourRow[]>`
      SELECT
        EXTRACT(HOUR FROM mh."createdAt")::int AS hour,
        COUNT(*)::bigint AS count
      FROM flows k
      JOIN conversations c ON c."flowId" = k.id
      JOIN message_history mh ON mh."conversationId" = c.id
      WHERE k."userId" = ${userId}
        AND k."isDeleted" = false
        AND mh."createdAt" BETWEEN ${startDate} AND ${endDate}
      GROUP BY hour
      ORDER BY hour
    `;

    return {
      messagesReceivedToday: Number(todayMsgsRow.count),
      newLeadsToday: Number(todayLeadsRow.count),
      totalLeads: Number(counts.totalLeads),
      totalInteractions: Number(counts.totalInteractions),
      leadsByDate: leadsByDateRows.map((r) => ({
        date: r.date,
        count: Number(r.count),
      })),
      messagesByDay: messagesByDayRows.map((r) => ({
        date: r.date,
        count: Number(r.count),
      })),
      conversationStatus: statusRows.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
      leadsByFlow: flowRows.map((r) => ({
        flow: r.flow,
        count: Number(r.count),
      })),
      messagesByHour: hourRows.map((r) => ({
        hour: r.hour,
        count: Number(r.count),
      })),
    };
  }
}
