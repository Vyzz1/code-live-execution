import { Module } from '@nestjs/common';
import { CodeSessionController } from './code-session.controller';
import { CodeSessionService } from './code-session.service';
import { TypeOrmModule } from '@nestjs/typeorm/dist/typeorm.module';
import { CodeSession } from './code-session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CodeSession])],
  providers: [CodeSessionService],
  controllers: [CodeSessionController],
})
export class CodeSessionModule {}
