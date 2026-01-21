import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';

import { Execution } from './execution.entity';
import { CodeSession } from '../code-session/code-session.entity';
import { ExecutionStatus } from '../../configs/constant';
import { ExecutionResponse } from './dto/response';

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
    idempotencyKey?: string,
  ): Promise<Execution> {
    const execution = this.executionRepo.create({
      session: session,
      status: ExecutionStatus.QUEUED,
      sourceCodeSnapshot: sourceCode,
      queuedAt: new Date(),
      attempt: 1,
      maxAttempts,
      idempotencyKey,
    });

    return this.executionRepo.save(execution);
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<Execution | null> {
    return this.executionRepo.findOne({
      where: {
        idempotencyKey,
      },
    });
  }

  async getExecution(executionId: string): Promise<ExecutionResponse> {
    const execution = await this.executionRepo.findOne({
      where: { id: executionId },
      relations: ['session'],
    });

    if (!execution) {
      throw new NotFoundException('Execution not found');
    }

    return ExecutionResponse.fromEntity(execution);
  }

  async getExecutionsBySession(
    sessionId: string,
  ): Promise<ExecutionResponse[]> {
    const executions = await this.executionRepo.find({
      where: { session: { id: sessionId } },
      order: { queuedAt: 'DESC' },
    });
    return executions.map((exe) => ExecutionResponse.fromEntity(exe));
  }
}
