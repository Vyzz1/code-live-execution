import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Execution } from './execution.entity';
import { CodeSession } from '../code-session/code-session.entity';
import { ExecutionStatus } from '../../configs/constant';

@Injectable()
export class ExecutionService {
  constructor(
    @InjectRepository(Execution)
    private readonly executionRepo: Repository<Execution>,
    @InjectRepository(CodeSession)
    private readonly sessionRepo: Repository<CodeSession>,
    @InjectQueue('code-execution')
    private readonly executionQueue: Queue,
  ) {}

  async runCodeSession(codeSessionId: string): Promise<Execution> {
    // Find the session
    const session = await this.sessionRepo.findOne({
      where: { id: codeSessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Create execution record
    const execution = this.executionRepo.create({
      session: session,
      status: ExecutionStatus.QUEUED,
      sourceCodeSnapshot: session.sourceCode,
      queuedAt: new Date(),
      attempt: 1,
      maxAttempts: 3,
    });

    await this.executionRepo.save(execution);

    // Add job to queue
    await this.executionQueue.add(
      'execute-code',
      {
        executionId: execution.id,
        sessionId: session.id,
        sourceCode: session.sourceCode,
        language: session.language,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    return execution;
  }

  async getExecution(executionId: string): Promise<Execution> {
    const execution = await this.executionRepo.findOne({
      where: { id: executionId },
      relations: ['session'],
    });

    if (!execution) {
      throw new NotFoundException('Execution not found');
    }

    return execution;
  }

  async getExecutionsBySession(sessionId: string): Promise<Execution[]> {
    return this.executionRepo.find({
      where: { session: { id: sessionId } },
      order: { queuedAt: 'DESC' },
    });
  }
}
