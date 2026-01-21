import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Execution } from '../execution/execution.entity';
import { CodeSession } from '../code-session/code-session.entity';
import { ExecutionStatus, DOCKER_CONFIG } from '../../configs/constant';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

interface ExecutionJobData {
  executionId: string;
  sessionId: string;
  sourceCode: string;
  language: string;
}

@Processor('code-execution')
@Injectable()
export class ExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExecutionProcessor.name);

  constructor(
    @InjectRepository(Execution)
    private readonly executionRepo: Repository<Execution>,
    @InjectRepository(CodeSession)
    private readonly sessionRepo: Repository<CodeSession>,
  ) {
    super();
  }

  async process(job: Job<ExecutionJobData>): Promise<void> {
    const { executionId, sessionId, sourceCode, language } = job.data;
    this.logger.log(
      `Processing execution ${executionId} for session ${sessionId}`,
    );

    const execution = await this.executionRepo.findOne({
      where: { id: executionId },
    });

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    try {
      // Update status to RUNNING
      execution.status = ExecutionStatus.RUNNING;
      execution.startedAt = new Date();
      await this.executionRepo.save(execution);

      // Execute code
      const result = await this.executeCode(sourceCode, language);

      // Update execution with results
      execution.stdout = result.stdout;
      execution.stderr = result.stderr;
      execution.exitCode = result.exitCode;
      execution.executionTimeMs = result.executionTimeMs;
      execution.finishedAt = new Date();

      // Check if execution failed (non-zero exit code)
      if (result.exitCode !== 0) {
        execution.status = ExecutionStatus.FAILED;
        execution.errorType =
          result.exitCode === 124 ? 'TimeoutError' : 'RuntimeError';
        execution.errorMessage =
          result.stderr || 'Execution failed with non-zero exit code';
      } else {
        execution.status = ExecutionStatus.COMPLETED;
      }

      await this.executionRepo.save(execution);

      // Update session's latest execution
      await this.sessionRepo.update(
        { id: sessionId },
        { latestExecutionId: executionId },
      );

      this.logger.log(`Execution ${executionId} completed successfully`);
    } catch (error) {
      this.logger.error(`Execution ${executionId} failed:`, error);

      execution.status = ExecutionStatus.FAILED;
      execution.errorType = error.name || 'Error';
      execution.errorMessage = error.message;
      execution.finishedAt = new Date();

      await this.executionRepo.save(execution);

      throw error;
    }
  }

  private async executeCode(
    sourceCode: string,
    language: string,
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    executionTimeMs: number;
  }> {
    const startTime = Date.now();
    const containerName = `code-exec-${randomUUID()}`;

    return new Promise((resolve) => {
      const dockerImage = DOCKER_CONFIG.images[language];
      if (!dockerImage) {
        resolve({
          stdout: '',
          stderr: `Unsupported language: ${language}`,
          exitCode: 1,
          executionTimeMs: Date.now() - startTime,
        });
        return;
      }

      const command = language === 'python' ? 'python' : 'node';
      const args =
        language === 'python' ? ['-c', sourceCode] : ['-e', sourceCode];

      // Docker run arguments with resource limits
      const dockerArgs = [
        'run',
        '--rm',
        '--name',
        containerName,
        '--memory',
        DOCKER_CONFIG.resourceLimits.memory,
        '--cpus',
        DOCKER_CONFIG.resourceLimits.cpus,
        '--pids-limit',
        DOCKER_CONFIG.resourceLimits.pids.toString(),
        '--network',
        DOCKER_CONFIG.network,
        '--read-only',
        ...DOCKER_CONFIG.securityOpts.flatMap((opt) => ['--security-opt', opt]),
        dockerImage,
        command,
        ...args,
      ];

      const child = spawn('docker', dockerArgs);

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Set timeout
      const timeout = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
        // Force remove container if it's still running
        spawn('docker', ['rm', '-f', containerName]);
      }, DOCKER_CONFIG.execution.timeout);

      // Collect stdout
      child.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > DOCKER_CONFIG.execution.maxBuffer) {
          killed = true;
          child.kill('SIGKILL');
          spawn('docker', ['rm', '-f', containerName]);
        }
      });

      // Collect stderr
      child.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > DOCKER_CONFIG.execution.maxBuffer) {
          killed = true;
          child.kill('SIGKILL');
          spawn('docker', ['rm', '-f', containerName]);
        }
      });

      // Handle completion
      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        const executionTimeMs = Date.now() - startTime;

        if (killed) {
          resolve({
            stdout: stdout.slice(0, DOCKER_CONFIG.execution.maxBuffer),
            stderr:
              stderr.slice(0, DOCKER_CONFIG.execution.maxBuffer) +
              '\n[Execution timeout or buffer exceeded]',
            exitCode: 124, // Standard timeout exit code
            executionTimeMs,
          });
        } else {
          resolve({
            stdout: stdout || '',
            stderr: stderr || '',
            exitCode: exitCode ?? 0,
            executionTimeMs,
          });
        }
      });

      // Handle errors
      child.on('error', (error) => {
        clearTimeout(timeout);
        spawn('docker', ['rm', '-f', containerName]);
        resolve({
          stdout: stdout || '',
          stderr: stderr || error.message,
          exitCode: 1,
          executionTimeMs: Date.now() - startTime,
        });
      });
    });
  }
}
