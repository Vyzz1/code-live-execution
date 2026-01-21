import { Module } from '@nestjs/common';
import { CodeSessionController } from './code-session.controller';
import { CodeSessionService } from './code-session.service';
import { TypeOrmModule } from '@nestjs/typeorm/dist/typeorm.module';
import { CodeSession } from './code-session.entity';
import { ExecutionModule } from '../execution/execution.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    TypeOrmModule.forFeature([CodeSession]),
    BullModule.registerQueue({
      name: 'code-execution',
    }),
    ExecutionModule,
  ],
  providers: [CodeSessionService],
  controllers: [CodeSessionController],
})
export class CodeSessionModule {}
