import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Execution } from '../execution/execution.entity';
import { CodeLanguage, CodeSessionStatus } from '../../configs/constant';

@Entity('code_sessions')
export class CodeSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({
    type: 'enum',
    enum: CodeLanguage,
  })
  language: CodeLanguage;

  @Column({ type: 'text' })
  sourceCode: string;

  @Index()
  @Column({
    type: 'enum',
    enum: CodeSessionStatus,
    default: CodeSessionStatus.ACTIVE,
  })
  status: CodeSessionStatus;

  @OneToMany(() => Execution, (execution) => execution.session)
  executions: Execution[];

  @Column({ type: 'uuid', nullable: true })
  latestExecutionId?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
