import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { CodeSession } from '../code-session/code-session.entity';
import { ExecutionStatus } from '../../configs/constant';

@Entity('executions')
export class Execution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CodeSession, (session) => session.executions, {
    onDelete: 'CASCADE',
  })
  session: CodeSession;

  @Index()
  @Column({
    type: 'enum',
    enum: ExecutionStatus,
    default: ExecutionStatus.QUEUED,
  })
  status: ExecutionStatus;

  @Column({ type: 'text' })
  sourceCodeSnapshot: string;

  @Column({ type: 'text', nullable: true })
  stdout?: string;

  @Column({ type: 'text', nullable: true })
  stderr?: string;

  @Column({ type: 'int', nullable: true })
  exitCode?: number;

  @Column({ type: 'int', nullable: true })
  executionTimeMs?: number;

  @Column({ type: 'int', default: 0 })
  attempt: number;

  @Column({ type: 'int', default: 3 })
  maxAttempts: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKey?: string;

  @CreateDateColumn()
  queuedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt?: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorType?: string;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;
}
