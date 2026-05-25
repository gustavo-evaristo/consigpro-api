import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetFormActiveDTO {
  @IsBoolean()
  @ApiProperty({ example: true })
  isActive: boolean;
}
