import { Controller, Post, Param, Get } from '@nestjs/common';
import { ExecutionService } from './execution.service';

@Controller('executions')
export class ExecutionController {
  constructor(private readonly executionService: ExecutionService) {}

  @Post('sessions/:sessionId/run')
  async runCodeSession(@Param('sessionId') sessionId: string) {
    const execution = await this.executionService.runCodeSession(sessionId);
    return {
      executionId: execution.id,
      status: execution.status,
      queuedAt: execution.queuedAt,
    };
  }

  @Get(':id')
  async getExecution(@Param('id') id: string) {
    return this.executionService.getExecution(id);
  }

  @Get('sessions/:sessionId')
  async getExecutionsBySession(@Param('sessionId') sessionId: string) {
    return this.executionService.getExecutionsBySession(sessionId);
  }
}
