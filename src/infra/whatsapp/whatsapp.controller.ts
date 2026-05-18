import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { JwtGuard } from '../authentication/jwt.guard';
import { WaJobProducerService } from '../wa-bridge/wa-job-producer.service';
import { isWaWorkerEnabled } from '../wa-bridge/wa-bridge.constants';

class StartWhatsappSessionDTO {
  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ example: '+5511999999999', nullable: true })
  phoneNumber?: string | null;
}

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private service: WhatsappService,
    private waJobs: WaJobProducerService,
  ) {}

  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiBody({ type: StartWhatsappSessionDTO, required: false })
  @Post('start')
  async start(@Req() { user }: IReq, @Body() body?: StartWhatsappSessionDTO) {
    const userId = user.id;
    // Modo proxy: enfileira job pro wa-worker. Modo local (legado):
    // chama o WhatsappService que tem Baileys embutido.
    if (isWaWorkerEnabled()) {
      await this.waJobs.startSession({
        userId,
        targetPhoneNumber: body?.phoneNumber ?? null,
      });
    } else {
      this.service.startSession(userId, body?.phoneNumber ?? null);
    }
    return { message: 'Iniciando sessão...', userId };
  }
}
