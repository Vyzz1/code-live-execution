import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CodeSessionService } from './code-session.service';
import { CreateSessionDto, UpdateSessionDto } from './dto/request';

@Controller('code-sessions')
export class CodeSessionController {
  constructor(private readonly codeSessionService: CodeSessionService) {}

  @Post()
  createCodeSession(@Body() dto: CreateSessionDto) {
    return this.codeSessionService.createSession(dto);
  }

  @Patch(':id')
  updateCodeSession(@Param('id') id: string, @Body() dto: UpdateSessionDto) {
    return this.codeSessionService.updateSession(id, dto);
  }
}
