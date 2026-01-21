import { Controller, Post, Param, Get, ParseUUIDPipe } from '@nestjs/common';
import { ExecutionService } from './execution.service';

@Controller('executions')
export class ExecutionController {
  constructor(private readonly executionService: ExecutionService) {}

  @Get(':sessionId')
  async getExecution(
    @Param('sessionId', new ParseUUIDPipe({})) sessionId: string,
  ) {
    return this.executionService.getExecution(sessionId);
  }

  @Get('sessions/:sessionId')
  async getExecutionsBySession(
    @Param('sessionId', new ParseUUIDPipe({})) sessionId: string,
  ) {
    return this.executionService.getExecutionsBySession(sessionId);
  }
}
