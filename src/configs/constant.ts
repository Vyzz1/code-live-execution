export enum CodeSessionStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum CodeLanguage {
  PYTHON = 'python',
  JAVASCRIPT = 'javascript',
}

export enum ExecutionStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  TIMEOUT = 'TIMEOUT',
}

export const defaultTemplates: Record<CodeLanguage, string> = {
  python: `print("Hello World")`,
  javascript: `console.log("Hello World")`,
};

// Docker execution configuration
export const DOCKER_CONFIG = {
  images: {
    python: 'python:3.11-alpine',
    javascript: 'node:20-alpine',
  },
  resourceLimits: {
    memory: '128m',
    cpus: '0.5',
    pids: 50,
  },
  execution: {
    timeout: 30000, // 30 seconds
    maxBuffer: 1024 * 1024, // 1MB
  },
  network: 'none', // No network access
  securityOpts: ['no-new-privileges:true'],
  readOnly: true,
};
