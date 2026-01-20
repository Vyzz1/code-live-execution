import { Expose } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CodeLanguage } from 'src/configs/constant';

export class CreateSessionDto {
  @IsEnum(CodeLanguage)
  @IsNotEmpty()
  language: CodeLanguage;

  @IsOptional()
  @IsString()
  templateCode?: string;
}

export class UpdateSessionDto {
  @IsString()
  @IsNotEmpty()
  @Expose({ name: 'source_code' })
  sourceCode: string;

  @IsEnum(CodeLanguage)
  @IsNotEmpty()
  language: CodeLanguage;
}
