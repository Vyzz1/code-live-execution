import { Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CodeSession } from './code-session.entity';
import { CreateSessionDto, UpdateSessionDto } from './dto/request';
import {
  CodeSessionStatus,
  defaultTemplates,
  JOB_QUEUE_CONFIG,
} from 'src/configs/constant';
import { CodeSessionResponse, RunCodeResponse } from './dto/response';
import { ExecutionService } from '../execution/execution.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
@Injectable()
export class CodeSessionService {
  constructor(
    @InjectRepository(CodeSession)
    private readonly sessionRepo: Repository<CodeSession>,
    private readonly executionService: ExecutionService,
    @InjectQueue('code-execution')
    private readonly executionQueue: Queue,
  ) {}

  async runCodeSession(codeSessionId: string): Promise<RunCodeResponse> {
    const session = await this.sessionRepo.findOne({
      where: { id: codeSessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const execution = await this.executionService.createExecution(
      session,
      session.sourceCode,
      JOB_QUEUE_CONFIG.options.attempts,
    );

    await this.executionQueue.add(
      JOB_QUEUE_CONFIG.name,
      {
        executionId: execution.id,
        sessionId: session.id,
        sourceCode: session.sourceCode,
        language: session.language,
      },
      {
        ...JOB_QUEUE_CONFIG.options,
      },
    );
    return new RunCodeResponse(execution.id, execution.status);
  }

  async createSession(dto: CreateSessionDto): Promise<CodeSessionResponse> {
    const session = this.sessionRepo.create({
      language: dto.language,
      sourceCode: dto.templateCode ?? defaultTemplates[dto.language],
      status: CodeSessionStatus.ACTIVE,
      updatedAt: new Date(),
    });

    await this.sessionRepo.save(session);

    return new CodeSessionResponse(session.id, session.status);
  }

  async updateSession(
    id: string,
    dto: Partial<UpdateSessionDto>,
  ): Promise<CodeSessionResponse> {
    const session = await this.sessionRepo.findOneBy({ id });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (dto.sourceCode !== undefined) {
      session.sourceCode = dto.sourceCode;
    }

    if (dto.language !== undefined) {
      session.language = dto.language;
    }
    session.updatedAt = new Date();

    await this.sessionRepo.save(session);

    return new CodeSessionResponse(session.id, session.status);
  }
}
