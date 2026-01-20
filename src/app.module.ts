import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './modules/database/database.module';
import { CodeSessionModule } from './modules/code-session/code-session.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { QueueModule } from './modules/queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    QueueModule,
    CodeSessionModule,
    ExecutionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
