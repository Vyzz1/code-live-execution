import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Execution } from './execution.entity';
import { CodeSession } from '../code-session/code-session.entity';
import { ExecutionStatus } from '../../configs/constant';

@Injectable()
export class ExecutionService {
  constructor(
    @InjectRepository(Execution)
    private readonly executionRepo: Repository<Execution>,
  ) {}

  async createExecution(
    session: CodeSession,
    sourceCode: string,
    maxAttempts: number,
  ): Promise<Execution> {
    const execution = this.executionRepo.create({
      session: session,
      status: ExecutionStatus.QUEUED,
      sourceCodeSnapshot: sourceCode,
      queuedAt: new Date(),
      attempt: 1,
      maxAttempts,
    });

    return this.executionRepo.save(execution);
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
