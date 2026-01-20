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
