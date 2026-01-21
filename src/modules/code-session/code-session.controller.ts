import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CodeSessionService } from './code-session.service';
import { CreateSessionDto, UpdateSessionDto } from './dto/request';

@Controller('code-sessions')
export class CodeSessionController {
  constructor(private readonly codeSessionService: CodeSessionService) {}

  @Post()
  createCodeSession(@Body() dto: CreateSessionDto) {
    return this.codeSessionService.createSession(dto);
  }
  @Post(':sessionId/run')
  runCodeSession(
    @Param('sessionId', new ParseUUIDPipe({})) sessionId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.codeSessionService.runCodeSession(sessionId, idempotencyKey);
  }

  @Patch(':sessionId')
  updateCodeSession(
    @Param('sessionId', new ParseUUIDPipe({})) sessionId: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.codeSessionService.updateSession(sessionId, dto);
  }
}
