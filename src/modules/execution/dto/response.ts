import { Expose } from 'class-transformer';
import { Execution } from '../execution.entity';

export class ExecutionResponse {
  @Expose({ name: 'execution_id' })
  executionId: string;

  @Expose({ name: 'status' })
  status: string;

  @Expose({ name: 'stdout' })
  stdout: string;

  @Expose({ name: 'stderr' })
  stderr: string;

  @Expose({ name: 'execution_time_ms' })
  executionTimeMs: number;

  @Expose({ name: 'error_message' })
  errorMsg?: string;

  @Expose({ name: 'error_type' })
  errorType?: string;

  static fromEntity(execution: Execution): ExecutionResponse {
    const response = new ExecutionResponse();
    response.executionId = execution.id;
    response.status = execution.status;
    response.stdout = execution.stdout || '';
    response.stderr = execution.stderr || '';
    response.executionTimeMs = execution.executionTimeMs || 0;
    response.errorMsg = execution.errorMessage || undefined;
    response.errorType = execution.errorType || undefined;
    return response;
  }
}
