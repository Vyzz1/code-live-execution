import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Execution } from './execution.entity';
import { CodeSession } from '../code-session/code-session.entity';
import { ExecutionService } from './execution.service';
import { ExecutionController } from './execution.controller';
import { ExecutionProcessor } from '../queue/execution.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Execution, CodeSession]),
    BullModule.registerQueue({
      name: 'code-execution',
    }),
  ],
  providers: [ExecutionService, ExecutionProcessor],
  controllers: [ExecutionController],
  exports: [ExecutionService],
})
export class ExecutionModule {}
