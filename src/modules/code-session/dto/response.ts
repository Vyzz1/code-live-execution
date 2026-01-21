import { Expose } from 'class-transformer';

export class CodeSessionResponse {
  @Expose({ name: 'session_id' })
  sessionId: string;

  @Expose({ name: 'status' })
  status: string;

  constructor(sessionId: string, status: string) {
    this.sessionId = sessionId;
    this.status = status;
  }
}

export class RunCodeResponse {
  @Expose({ name: 'execution_id' })
  executionId: string;

  @Expose({ name: 'status' })
  status: string;

  constructor(executionId: string, status: string) {
    this.executionId = executionId;
    this.status = status;
  }
}
