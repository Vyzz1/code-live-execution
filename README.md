# Code Live Execution Platform

A production-ready, secure code execution platform built with NestJS that allows users to execute Python and JavaScript code in isolated Docker containers. Features include session management, async execution with BullMQ, idempotent API operations, and comprehensive execution tracking.

## 🏗️ Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client/Frontend                          │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/REST
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NestJS API Server (Port 3000)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │   Session    │  │  Execution   │  │   Queue Processor   │   │
│  │  Controller  │  │  Controller  │  │   (BullMQ Worker)   │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘   │
│         │                 │                      │              │
│  ┌──────▼─────────────────▼──────────────────────▼──────────┐   │
│  │              Business Logic Layer                        │   │
│  │  (Session Service, Execution Service, Job Processing)   │   │
│  └──────┬───────────────────┬──────────────────┬───────────┘   │
└─────────┼───────────────────┼──────────────────┼───────────────┘
          │                   │                  │
          ▼                   ▼                  ▼
┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐
│   PostgreSQL    │  │   Redis/BullMQ   │  │ Docker Engine  │
│   (Port 5432)   │  │   (Port 6379)    │  │  (Container    │
│                 │  │                  │  │   Execution)   │
│ - Sessions      │  │ - Job Queue      │  │                │
│ - Executions    │  │ - Rate Limiting  │  │ - Python:3.11  │
│ - Relationships │  │ - Idempotency    │  │ - Node:20      │
└─────────────────┘  └──────────────────┘  └────────────────┘
```

### Component Architecture

**API Layer**
- **Session Controller**: Manages code session lifecycle (create, update, trigger execution)
- **Execution Controller**: Provides execution status and history retrieval

**Service Layer**
- **Session Service**: Business logic for session operations, integrates with queue
- **Execution Service**: Manages execution records and retrieval
- **Queue Processor**: Async worker that executes code in Docker containers

**Data Layer**
- **PostgreSQL**: Persistent storage for sessions and execution history
- **Redis/BullMQ**: Message queue for async job processing and idempotency tracking

**Execution Engine**
- **Docker Containers**: Isolated, secure environments for code execution
- Resource-limited containers (128MB RAM, 0.5 CPU, 30s timeout)
- Network isolation and read-only filesystem for security

### Data Flow

1. **Create Session** → Store in PostgreSQL with default template
2. **Update Session** → Update source code in session record
3. **Run Code** → 
   - Check idempotency key → Return existing execution if duplicate
   - Create execution record (QUEUED)
   - Add job to BullMQ queue
   - Return execution ID immediately
4. **Process Job** (Async) →
   - Update status to RUNNING
   - Spin up isolated Docker container
   - Execute code with resource limits
   - Capture stdout/stderr/execution time
   - Update execution record with results
   - Clean up container
5. **Get Status** → Query execution record from PostgreSQL

##  Features

- **Multi-language Support**: Python 3.11 and Node.js 20
- **Async Execution**: Non-blocking code execution using BullMQ
- **Idempotency**: Prevent duplicate executions with idempotency keys
- **Session Management**: Persistent code sessions with update capabilities
- **Execution Tracking**: Complete history of all code runs per session
- **Security**: Sandboxed Docker containers with resource limits
- **Retry Logic**: Automatic retry with exponential backoff (3 attempts)
- **Performance Monitoring**: Execution time tracking in milliseconds
- **Error Handling**: Comprehensive error types and messages

## Setup Instructions

### Prerequisites

- **Docker** and **Docker Compose** (required for running the application)
- **Node.js** 20+ and **pnpm** (for local development)
- **Git** (for cloning the repository)

### Quick Start (Docker Compose)

1. **Clone the repository**
   ```bash
   git clone https://github.com/Vyzz1/code-live-execution
   cd code-live-execution
   ```

2. **Create environment file**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your configuration:
   ```env
   NODE_ENV=production
   PORT=3000
   DATABASE_URL=postgresql://root:secret@postgres13:5432/code_live_execution
   REDIS_HOST=redis
   REDIS_PORT=6379
   ```

3. **Start all services**
   ```bash
   docker compose up -d
   ```

   This will start:
   - API Server (http://localhost:3000)
   - PostgreSQL (localhost:5432)
   - Redis (localhost:6379)
   - PgAdmin (http://localhost:8080)

4. **Run database migrations**
   ```bash
   docker compose exec api npm run migration:run
   ```

5. **Verify the setup**
   ```bash
   curl http://localhost:3000/health
   ```

### Local Development Setup

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Start infrastructure services**
   ```bash
   docker compose up -d postgres13 redis
   ```

3. **Set up local environment**
   ```env
   NODE_ENV=development
   PORT=3000
   DATABASE_URL=postgresql://root:secret@localhost:5432/code_live_execution
   REDIS_HOST=localhost
   REDIS_PORT=6379
   ```

4. **Run migrations**
   ```bash
   pnpm run migration:run
   ```

5. **Start development server**
   ```bash
   pnpm run start:dev
   ```

### PgAdmin Access

Access the database GUI at http://localhost:8080
- Email: `vy@gmail.com`
- Password: `123456`

Add a new server connection:
- Host: `postgres13`
- Port: `5432`
- Username: `root`
- Password: `secret`
- Database: `code_live_execution`

##  API Documentation

Base URL: `http://localhost:3000`

### Endpoints Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/code-sessions` | Create a new code session |
| PATCH | `/code-sessions/:sessionId` | Update session source code |
| POST | `/code-sessions/:sessionId/run` | Execute code (async) |
| GET | `/executions/:executionId` | Get execution details |
| GET | `/executions/sessions/:sessionId` | Get all executions for a session |

---

### 1. Create Code Session

**Endpoint:** `POST /code-sessions`

Creates a new code session with optional template code.

**Request Body:**
```json
{
  "language": "python",
  "templateCode": "print('Hello World')"
}
```

**Request Schema:**
- `language` (required): `"python"` or `"javascript"`
- `templateCode` (optional): Initial code template (defaults to "Hello World" for each language)

**Response:** `201 Created`
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "ACTIVE"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/code-sessions \
  -H "Content-Type: application/json" \
  -d '{
    "language": "python",
    "templateCode": "print(\"Hello from Python\")"
  }'
```

---

### 2. Update Code Session

**Endpoint:** `PATCH /code-sessions/:sessionId`

Updates the source code for an existing session.

**Path Parameters:**
- `sessionId` (UUID): The session identifier

**Request Body:**
```json
{
  "source_code": "def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\nprint(fibonacci(10))",
  "language": "python"
}
```

**Request Schema:**
- `source_code` (required): The new source code to execute
- `language` (required): `"python"` or `"javascript"`

**Response:** `200 OK`
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "ACTIVE"
}
```

**Example:**
```bash
curl -X PATCH http://localhost:3000/code-sessions/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{
    "source_code": "for i in range(5):\n    print(f\"Count: {i}\")",
    "language": "python"
  }'
```

**Error Responses:**
- `404 Not Found`: Session doesn't exist
- `400 Bad Request`: Invalid language or missing source_code

---

### 3. Execute Code

**Endpoint:** `POST /code-sessions/:sessionId/run`

Queues the session's code for async execution in an isolated Docker container.

**Path Parameters:**
- `sessionId` (UUID): The session identifier

**Headers:**
- `idempotency-key` (optional): Prevents duplicate executions. If omitted, a UUID is auto-generated.

**Request Body:** None

**Response:** `200 OK` (Immediate response, execution happens asynchronously)
```json
{
  "execution_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "QUEUED"
}
```

**Response Codes:**
- `200 OK`: Execution queued or found existing execution with same idempotency key
- `404 Not Found`: Session doesn't exist

**Example:**
```bash
# Without idempotency key (generates new execution each time)
curl -X POST http://localhost:3000/code-sessions/550e8400-e29b-41d4-a716-446655440000/run

# With idempotency key (prevents duplicates)
curl -X POST http://localhost:3000/code-sessions/550e8400-e29b-41d4-a716-446655440000/run \
  -H "idempotency-key: my-unique-key-123"
```

**Idempotency Behavior:**
- If the same `idempotency-key` is used multiple times, the API returns the original execution ID without creating a new execution
- Useful for retry logic and preventing accidental duplicate submissions
- If no key is provided, each request creates a new execution

---

### 4. Get Execution Status

**Endpoint:** `GET /executions/:executionId`

Retrieves detailed results of a specific code execution.

**Path Parameters:**
- `executionId` (UUID): The execution identifier

**Response:** `200 OK`
```json
{
  "execution_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "COMPLETED",
  "stdout": "Count: 0\nCount: 1\nCount: 2\nCount: 3\nCount: 4\n",
  "stderr": "",
  "execution_time_ms": 1247,
  "error_message": null,
  "error_type": null
}
```

**Response Schema:**
- `execution_id`: Unique execution identifier
- `status`: `"QUEUED"`, `"RUNNING"`, `"COMPLETED"`, `"FAILED"`, or `"TIMEOUT"`
- `stdout`: Standard output from the code execution
- `stderr`: Standard error output
- `execution_time_ms`: Execution duration in milliseconds
- `error_message`: Error description (if failed)
- `error_type`: `"RuntimeError"`, `"TimeoutError"`, etc. (if failed)

**Example:**
```bash
curl http://localhost:3000/executions/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Status Types:**
- `QUEUED`: Waiting in queue for execution
- `RUNNING`: Currently executing in Docker container
- `COMPLETED`: Successfully executed (exit code 0)
- `FAILED`: Execution failed (non-zero exit code or runtime error)
- `TIMEOUT`: Exceeded 30-second time limit

---

### 5. Get Session Execution History

**Endpoint:** `GET /executions/sessions/:sessionId`

Retrieves all executions for a specific session, ordered by most recent first.

**Path Parameters:**
- `sessionId` (UUID): The session identifier

**Response:** `200 OK`
```json
[
  {
    "execution_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "COMPLETED",
    "stdout": "Hello from Python\n",
    "stderr": "",
    "execution_time_ms": 1089,
    "error_message": null,
    "error_type": null
  },
  {
    "execution_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "status": "FAILED",
    "stdout": "",
    "stderr": "SyntaxError: invalid syntax\n",
    "execution_time_ms": 234,
    "error_message": "SyntaxError: invalid syntax",
    "error_type": "RuntimeError"
  }
]
```

**Example:**
```bash
curl http://localhost:3000/executions/sessions/550e8400-e29b-41d4-a716-446655440000
```

**Response:** Empty array `[]` if no executions exist for the session

---


### Error Handling

All endpoints return standard HTTP error codes:

**400 Bad Request**
```json
{
  "statusCode": 400,
  "message": ["language must be one of the following values: python, javascript"],
  "error": "Bad Request"
}
```

**404 Not Found**
```json
{
  "statusCode": 404,
  "message": "Session not found",
  "error": "Not Found"
}
```

**500 Internal Server Error**
```json
{
  "statusCode": 500,
  "message": "Internal server error"
}
```

## Design Decisions and Trade-offs

### 1. **Async Execution with BullMQ**
**Decision:** Use BullMQ for async job processing instead of synchronous execution

**Rationale:**
- Code execution can take several seconds (up to 30s timeout)
- Prevents blocking HTTP connections and improves API responsiveness
- Allows horizontal scaling of workers independently from API servers
- Built-in retry mechanism with exponential backoff
- Redis-backed ensures jobs survive server restarts

**Trade-offs:**
- Added complexity with message queue infrastructure
- Requires polling or webhooks to get results
- Eventual consistency between job submission and completion

### 2. **Docker-in-Docker (DinD) for Code Execution**
**Decision:** Mount Docker socket (`/var/run/docker.sock`) to run sibling containers

**Rationale:**
- Strong isolation: Each execution gets a fresh container environment
- Security: Resource limits (CPU, memory), network isolation, read-only filesystem
- Language flexibility: Easy to add new languages by adding Docker images
- Clean state: No leftover files or processes between executions

**Trade-offs:**
- Requires Docker engine access (security consideration)
- Startup overhead (~1-2 seconds per container)
- Resource consumption (each execution spawns a new container)
- Container cleanup responsibility (implemented with `--rm` flag)

**Security Measures:**
- `--network=none`: No internet access
- `--read-only`: Immutable filesystem
- `--security-opt=no-new-privileges`: Prevents privilege escalation
- Resource limits: `--memory=128m --cpus=0.5 --pids-limit=50`

### 3. **Idempotency with Unique Keys**
**Decision:** Implement idempotency using unique constraint on `idempotency_key` column

**Rationale:**
- Prevents duplicate executions from network retries or user double-clicks
- Database-level guarantee (PostgreSQL unique constraint)
- Race condition handling with `23505` error code detection
- Client can provide key or system generates UUID

**Trade-offs:**
- Requires additional database column and index
- Need to handle race conditions explicitly
- Keys must be managed by clients for custom deduplication windows

### 4. **Session-Based Code Management**
**Decision:** Separate sessions (mutable code) from executions (immutable snapshots)

**Rationale:**
- Allows users to iterate on code without losing execution history
- Execution record stores snapshot of code at execution time
- Supports "run last successful" or "compare versions" features
- Clear separation of concerns (session = workspace, execution = run)

**Trade-offs:**
- More complex data model (two tables with relationship)
- Need to sync `sourceCode` to `sourceCodeSnapshot` on each run
- Storage overhead (duplicates code for each execution)

### 5. **PostgreSQL + Redis Architecture**
**Decision:** Use PostgreSQL for persistence and Redis for queuing

**Rationale:**
- PostgreSQL: ACID compliance, complex queries, referential integrity
- Redis: High-throughput queue operations, low-latency job processing
- Separation of concerns: persistent state vs. transient jobs
- Redis features: atomic operations, pub/sub, TTL for idempotency tracking

**Trade-offs:**
- Two databases to maintain and backup
- Network latency between services
- Redis is not durable by default (configure AOF for production)

### 6. **No Real-time Status Updates**
**Decision:** Polling-based status retrieval (GET /executions/:id)

**Rationale:**
- Simpler architecture (no WebSocket infrastructure)
- RESTful design principles
- Easier to cache and scale
- Lower server resource usage (no persistent connections)

**Trade-offs:**
- Higher latency to get results (need to poll)
- More API requests (polling overhead)
- Not ideal for interactive/live coding UX

### 7. **Fixed Resource Limits**
**Decision:** Hard-coded resource limits (128MB RAM, 0.5 CPU, 30s timeout)

**Rationale:**
- Prevents resource exhaustion (infinite loops, memory leaks)
- Fair usage across all users
- Predictable cost and capacity planning
- Sufficient for interview coding challenges

**Trade-offs:**
- Can't run resource-intensive algorithms
- May timeout on complex computations
- No user customization (one-size-fits-all)

### 8. **Exit Code-Based Error Detection**
**Decision:** Treat non-zero exit codes as failures, capture stderr

**Rationale:**
- Standard Unix convention (exit 0 = success)
- Language-agnostic approach
- stderr naturally captures error messages
- Timeout detection via exit code 124

**Trade-offs:**
- Can't distinguish between different error types automatically
- Relies on language runtime error handling
- No semantic error parsing (just text in stderr)

##  Future Improvements

### High Priority

1. **WebSocket Support for Real-time Updates**
   - Push execution status changes to clients instantly
   - Eliminate polling overhead
   - Better UX for interactive coding platforms
   - Implementation: Socket.IO or native WebSocket with Redis adapter for horizontal scaling

2. **Authentication & Authorization**
   - JWT-based auth with role-based access control (RBAC)
   - Per-user session isolation (add `userId` foreign key)
   - API rate limiting per user (BullMQ rate limiter)
   - Prevents abuse and enables multi-tenancy

3. **Advanced Resource Management**
   - User-configurable resource tiers (free: 128MB, pro: 512MB)
   - Dynamic timeout based on tier
   - Quotas: Max executions per day/hour per user
   - Cost tracking for billing purposes

4. **Extended Language Support**
   - Add Go, Rust, Java, C++, Ruby, PHP
   - Language-specific security profiles
   - Standard library availability configuration
   - Package/dependency management (pip, npm install)

5. **Enhanced Error Analysis**
   - Parse stderr for common error patterns
   - Syntax error highlighting with line numbers
   - Stack trace parsing and prettification
   - Suggested fixes for common errors (AI-powered)

### Medium Priority

6. **Execution Result Caching**
   - Cache results by code hash + language
   - Skip re-execution for identical code
   - Reduces Docker overhead for repeated runs
   - TTL-based cache invalidation

7. **Code Persistence & Version Control**
   - Track code changes over time (version history)
   - Diff view between versions
   - Rollback to previous versions
   - Git-like branching for experimentation

8. **Output Streaming**
   - Stream stdout/stderr as execution progresses
   - Real-time progress updates for long-running code
   - Implementation: Docker attach with TTY streaming

9. **Execution Analytics Dashboard**
   - Metrics: Average execution time, failure rate, resource usage
   - Popular languages, peak usage times
   - Error trends and common failure points
   - Cost optimization insights

10. **Input/Output Testing Framework**
    - Define test cases with expected outputs
    - Automatic test execution and validation
    - Test coverage reporting
    - TDD support for coding challenges

### Low Priority

11. **Multi-file Project Support**
    - Upload multiple files (e.g., Python modules, JS files)
    - Maintain directory structure in container
    - Inter-file imports and dependencies

12. **Collaborative Editing**
    - Multiple users editing same session (CRDT-based)
    - Live cursor positions and selections
    - Chat/comments within sessions

13. **Scheduled Executions**
    - Cron-like scheduling for periodic runs
    - Recurring test suites
    - Monitoring/alerting on failures

14. **Container Image Customization**
    - User-provided Dockerfiles
    - Custom base images with pre-installed packages
    - Private image registry support

15. **Export & Sharing**
    - Public URLs for read-only session viewing
    - Embed execution results in external sites (iframe)
    - PDF/screenshot export of results


##  Technology Stack

- **Framework:** NestJS 11 (TypeScript)
- **Language Runtime:** Node.js 20
- **Database:** PostgreSQL 13
- **Queue:** Redis 7 + BullMQ
- **ORM:** TypeORM
- **Validation:** class-validator, class-transformer
- **Container Runtime:** Docker 20+
- **Package Manager:** pnpm
- **Execution Environments:**
  - Python: 3.11-alpine
  - JavaScript: node:20-alpine


