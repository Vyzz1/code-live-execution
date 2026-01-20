import { Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CodeSession } from './code-session.entity';
import { CreateSessionDto, UpdateSessionDto } from './dto/request';
import { CodeSessionStatus, defaultTemplates } from 'src/configs/constant';
import { CodeSessionResponse } from './dto/response';
@Injectable()
export class CodeSessionService {
  constructor(
    @InjectRepository(CodeSession)
    private readonly sessionRepo: Repository<CodeSession>,
  ) {}

  async createSession(dto: CreateSessionDto): Promise<CodeSessionResponse> {
    const session = this.sessionRepo.create({
      language: dto.language,
      sourceCode: dto.templateCode ?? defaultTemplates[dto.language],
      status: CodeSessionStatus.ACTIVE,
      updatedAt: new Date(),
    });

    await this.sessionRepo.save(session);

    return new CodeSessionResponse(session.id, session.status);
  }

  async updateSession(
    id,
    dto: Partial<UpdateSessionDto>,
  ): Promise<CodeSessionResponse> {
    const session = await this.sessionRepo.findOneBy({ id });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (dto.sourceCode !== undefined) {
      session.sourceCode = dto.sourceCode;
    }

    if (dto.language !== undefined) {
      session.language = dto.language;
    }
    session.updatedAt = new Date();

    await this.sessionRepo.save(session);

    return new CodeSessionResponse(session.id, session.status);
  }
}
