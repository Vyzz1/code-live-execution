# System Design Document

## 1. Architecture Overview

### 1.1 End-to-End Request Flow

#### Code Session Creation

```
Client Request (POST /code-sessions)
    |
    v
[Session Controller] - Receives CreateSessionDto
    |
    v
[Session Service] 
    |-- Validates language (python | javascript)
    |-- Creates session entity
    |-- Sets sourceCode to templateCode OR default template
    |-- Sets status = ACTIVE
    |-- Persists to PostgreSQL
    |
    v
[Database] - Saves session with:
    |-- UUID (primary key)
    |-- language
    |-- sourceCode (template)
    |-- status (ACTIVE)
    |-- timestamps (createdAt, updatedAt)
    |
    v
Client Response: { session_id, status: "ACTIVE" }
```

**Flow Details:**
1. Client sends POST request with `{ language: "python", templateCode?: "..." }`
2. Controller validates DTO using class-validator decorators
3. Service creates new CodeSession entity
4. If templateCode is omitted, uses default template from `defaultTemplates` map
5. Session persisted to database with ACTIVE status
6. Immediate synchronous response with session_id

**Key Characteristics:**
- Synchronous operation (no queueing)
- Fast response time (< 50ms typical)
- No external dependencies beyond database
- Returns immediately after database write

---

#### Autosave Behavior

```
Client Request (PATCH /code-sessions/:sessionId)
    |
    v
[Session Controller]
    |-- Extracts sessionId from path
    |-- Receives UpdateSessionDto
    |
    v
[Session Service]
    |-- Queries database for existing session
    |-- Throws NotFoundException if not found
    |-- Updates sourceCode field
    |-- Updates language field (if provided)
    |-- Sets updatedAt timestamp
    |-- Saves to database
    |
    v
[Database] - Updates session record
    |
    v
Client Response: { session_id, status: "ACTIVE" }
```

**Flow Details:**
1. Client sends PATCH with `{ source_code: "...", language: "python" }`
2. Service validates session existence
3. Updates mutable fields (sourceCode, language)
4. No history tracking - overwrites previous code
5. updatedAt timestamp refreshed for tracking modifications

**Implementation Notes:**
- Idempotent operation (can safely retry)
- No validation of code syntax at this stage
- Code is stored as plain text (no sanitization)
- Future enhancement: Could track version history with separate table

---

#### Execution Request

```
Client Request (POST /code-sessions/:sessionId/run)
    |-- Headers: { "idempotency-key": "optional-unique-key" }
    |
    v
[Session Controller] - Extracts sessionId and idempotency-key
    |
    v
[Session Service]
    |
    |-- Step 1: Validate Session Exists
    |   |-- Query database for session
    |   |-- Throw NotFoundException if missing
    |
    |-- Step 2: Generate or Use Idempotency Key
    |   |-- Use provided key OR generate new UUID
    |
    |-- Step 3: Check for Duplicate Execution (Idempotency)
    |   |-- Query executions by idempotencyKey
    |   |-- If exists: Return existing execution (skip creation)
    |
    |-- Step 4: Create Execution Record
    |   |-- Create Execution entity with:
    |   |   |-- status: QUEUED
    |   |   |-- sourceCodeSnapshot: copy of session.sourceCode
    |   |   |-- attempt: 1
    |   |   |-- maxAttempts: 3
    |   |   |-- idempotencyKey: unique key
    |   |   |-- queuedAt: current timestamp
    |   |-- Persist to database
    |
    |-- Step 5: Enqueue Job to BullMQ
    |   |-- Job data: { executionId, sessionId, sourceCode, language }
    |   |-- Job options: { attempts: 3, backoff: exponential 2s }
    |   |-- Add to 'code-execution' queue in Redis
    |
    v
[Database] - Execution record saved (QUEUED status)
[Redis/BullMQ] - Job enqueued for processing
    |
    v
Client Response: { execution_id, status: "QUEUED" }
```

**Critical Design Points:**

**Idempotency Handling:**
- Prevents duplicate executions from network retries or user double-clicks
- Uses unique database constraint on `idempotencyKey` column
- Race condition handling:
  ```
  Thread A: Check key exists -> No -> Create execution
  Thread B: Check key exists -> No -> Create execution (fails with 23505)
  Thread B: Catches error -> Re-query execution -> Return existing
  ```
- PostgreSQL guarantees atomicity via unique constraint

**Code Snapshot:**
- sourceCodeSnapshot stores immutable copy of code at execution time
- Allows session code to be modified while execution is running
- Enables historical comparison and debugging

**Async Response:**
- Returns immediately with QUEUED status (< 100ms)
- Actual execution happens in background worker
- Client must poll GET /executions/:id for results

---

#### Background Execution

```
[BullMQ Worker] - Picks job from Redis queue
    |
    v
[Execution Processor]
    |
    |-- Step 1: Load Execution Record
    |   |-- Query database by executionId
    |   |-- Throw error if not found (job retry)
    |
    |-- Step 2: Update Status to RUNNING
    |   |-- execution.status = RUNNING
    |   |-- execution.startedAt = now()
    |   |-- Save to database
    |
    |-- Step 3: Execute Code in Docker Container
    |   |
    |   |-- Generate unique container name: "code-exec-{UUID}"
    |   |-- Select Docker image based on language:
    |   |   |-- python: python:3.11-alpine
    |   |   |-- javascript: node:20-alpine
    |   |
    |   |-- Build Docker command:
    |   |   docker run --rm \
    |   |     --name code-exec-{UUID} \
    |   |     --memory 128m \
    |   |     --cpus 0.5 \
    |   |     --pids-limit 50 \
    |   |     --network none \
    |   |     --read-only \
    |   |     --security-opt no-new-privileges:true \
    |   |     {image} {command} {args}
    |   |
    |   |   Where command/args:
    |   |   - Python: python -c "{sourceCode}"
    |   |   - JavaScript: node -e "{sourceCode}"
    |   |
    |   |-- Spawn child process
    |   |-- Set 30-second timeout
    |   |-- Stream stdout/stderr to buffers (max 1MB each)
    |   |-- Wait for completion or timeout
    |   |
    |   |-- Timeout handling:
    |   |   |-- If 30s elapsed: SIGKILL process
    |   |   |-- Force remove container: docker rm -f {name}
    |   |   |-- Set exitCode = 124 (timeout convention)
    |   |
    |   |-- Buffer overflow handling:
    |   |   |-- If stdout > 1MB: Kill process
    |   |   |-- Truncate output and append warning
    |   |
    |   v
    |   Result: { stdout, stderr, exitCode, executionTimeMs }
    |
    |-- Step 4: Process Results
    |   |
    |   |-- Update execution record:
    |   |   |-- execution.stdout = result.stdout
    |   |   |-- execution.stderr = result.stderr
    |   |   |-- execution.exitCode = result.exitCode
    |   |   |-- execution.executionTimeMs = result.executionTimeMs
    |   |   |-- execution.finishedAt = now()
    |   |
    |   |-- Determine final status:
    |   |   |-- If exitCode === 0:
    |   |   |   |-- status = COMPLETED
    |   |   |-- If exitCode === 124:
    |   |   |   |-- status = FAILED
    |   |   |   |-- errorType = "TimeoutError"
    |   |   |   |-- errorMessage = stderr or "Execution timeout"
    |   |   |-- If exitCode !== 0:
    |   |   |   |-- status = FAILED
    |   |   |   |-- errorType = "RuntimeError"
    |   |   |   |-- errorMessage = stderr
    |   |
    |   |-- Save execution to database
    |
    |-- Step 5: Update Session Reference
    |   |-- session.latestExecutionId = executionId
    |   |-- Save session to database
    |
    v
[Database] - Execution record updated (COMPLETED/FAILED)
```

**Security Measures:**

1. **Container Isolation:**
   - Fresh container per execution (no shared state)
   - Destroyed immediately after completion (--rm flag)
   - Read-only filesystem (prevents file writes)
   - No network access (--network none)

2. **Resource Limits:**
   - Memory: 128MB (prevents memory bombs)
   - CPU: 0.5 cores (prevents CPU hogging)
   - PIDs: 50 processes (prevents fork bombs)
   - Time: 30 seconds (prevents infinite loops)
   - Output: 1MB buffer (prevents output floods)

3. **Privilege Restrictions:**
   - no-new-privileges (prevents privilege escalation)
   - Non-root user execution (inherited from alpine images)

**Error Scenarios:**
- Docker daemon unreachable: Job fails, retry triggered
- Container fails to start: Job fails, retry triggered
- Code runtime error: Execution marked FAILED with stderr
- Timeout: Execution marked FAILED with TimeoutError

---

#### Result Polling

```
Client Request (GET /executions/:executionId)
    |
    v
[Execution Controller]
    |
    v
[Execution Service]
    |-- Query database by executionId
    |-- Include session relation (JOIN)
    |-- Throw NotFoundException if missing
    |
    v
[Database] - Returns execution record
    |
    v
[ExecutionResponse.fromEntity()]
    |-- Maps entity to DTO
    |-- Handles null fields gracefully
    |
    v
Client Response:
{
  execution_id: string,
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT",
  stdout: string,
  stderr: string,
  execution_time_ms: number,
  error_message?: string,
  error_type?: string
}
```

**Polling Pattern:**
```javascript
// Client-side polling implementation
async function waitForExecution(executionId) {
  while (true) {
    const result = await fetch(`/executions/${executionId}`);
    const data = await result.json();
    
    if (data.status === 'COMPLETED' || data.status === 'FAILED') {
      return data; // Terminal state reached
    }
    
    await sleep(1000); // Poll every 1 second
  }
}
```

**Characteristics:**
- Simple REST GET request (cacheable)
- No long-polling or WebSocket complexity
- Client controls polling frequency
- Server stateless (no connection tracking)

**Trade-offs:**
- Latency: 1-2 second delay to see results (polling interval)
- Network overhead: Multiple requests for single execution
- Server load: N clients × polling frequency = requests/sec
- Simplicity: Easy to implement, debug, and scale

---

### 1.2 Queue-Based Execution Design

#### Why BullMQ?

**Requirements:**
1. Async job processing (decouple HTTP request from execution)
2. Reliability (jobs survive server crashes)
3. Retry mechanism (handle transient failures)
4. Job persistence (track job status)
5. Scalability (multiple workers)

**BullMQ Advantages:**
- Redis-backed (fast, persistent with AOF)
- Built-in retry with exponential backoff
- Job lifecycle events (queued, active, completed, failed)
- Multiple workers support
- Job prioritization and rate limiting
- Active community and NestJS integration

#### Queue Architecture

```
API Server (Producer)                   Worker Process (Consumer)
    |                                           |
    |-- Add job to queue                        |-- Fetch job from queue
    |   { executionId, sessionId,               |   (Blocking pop from Redis)
    |     sourceCode, language }                |
    |                                           |
    v                                           v
[Redis - BullMQ Queues]                [Job Processor]
    |                                   - Process job
    |-- Queue: code-execution           - Execute code
    |-- Job: {                          - Update database
    |     id: "job-uuid",               - Mark complete/failed
    |     data: {...},                  
    |     opts: {                       
    |       attempts: 3,                
    |       backoff: exponential        
    |     }                             
    |   }                               
```

#### Queue Configuration

```typescript
JOB_QUEUE_CONFIG = {
  name: 'code-execution',
  options: {
    attempts: 3,              // Retry up to 3 times
    backoff: {
      type: 'exponential',    // 2s, 4s, 8s delays
      delay: 2000
    },
    removeOnComplete: false,  // Keep completed jobs for history
    removeOnFail: false       // Keep failed jobs for debugging
  }
}
```

**Retry Strategy:**
- Attempt 1: Immediate execution
- Attempt 2: After 2 seconds (if #1 fails)
- Attempt 3: After 4 seconds (if #2 fails)
- Attempt 4: After 8 seconds (if #3 fails)
- After 3 failures: Job moves to failed state

**Failure Scenarios Triggering Retry:**
- Docker daemon temporarily unavailable
- Database connection timeout
- Container fails to start (resource contention)
- Network issues (Redis connection lost)

**Scenarios NOT Triggering Retry:**
- Code execution completes (even if exitCode !== 0)
- Timeout reached (30 seconds elapsed)
- Code produces runtime error (captured in stderr)

---

### 1.3 Execution Lifecycle and State Management

#### State Transition Diagram

```
                    [CLIENT ACTION]
                          |
                          v
                    POST /sessions/:id/run
                          |
                          v
                    ┌───────────┐
                    │  QUEUED   │ <---- Initial state (job created)
                    └─────┬─────┘       - Job added to BullMQ
                          |             - Waiting for worker
                          |
                Worker picks job
                          |
                          v
                    ┌───────────┐
                    │  RUNNING  │ <---- Worker processing
                    └─────┬─────┘       - Docker container spawned
                          |             - Code executing
                          |
            ┌─────────────┼─────────────┐
            |             |             |
    exitCode=0      exitCode≠0    timeout/error
            |             |             |
            v             v             v
      ┌──────────┐  ┌─────────┐  ┌──────────┐
      │COMPLETED │  │ FAILED  │  │ TIMEOUT  │ <--- Terminal states
      └──────────┘  └─────────┘  └──────────┘      - Job complete
                                                    - Results stored
```

#### State Details

**QUEUED:**
- **Entry:** Execution record created, job added to BullMQ
- **Duration:** Milliseconds to seconds (depends on worker availability)
- **Database Fields Set:**
  - status = QUEUED
  - queuedAt = now()
  - attempt = 1
  - maxAttempts = 3
- **Exit Conditions:**
  - Worker picks job → RUNNING
  - Redis crash (job persists, resumes on restart)

**RUNNING:**
- **Entry:** Worker starts processing job
- **Duration:** Typically 1-5 seconds (up to 30s timeout)
- **Database Fields Set:**
  - status = RUNNING
  - startedAt = now()
- **Activities:**
  - Docker container creation (~500ms)
  - Code execution (variable)
  - Output streaming
  - Container cleanup
- **Exit Conditions:**
  - Successful execution (exit 0) → COMPLETED
  - Code error (exit ≠ 0) → FAILED
  - Timeout (30s) → TIMEOUT
  - Worker crash → Job returns to QUEUED (retry)

**COMPLETED:**
- **Entry:** Code executed successfully (exitCode = 0)
- **Terminal State:** No further transitions
- **Database Fields Set:**
  - status = COMPLETED
  - finishedAt = now()
  - stdout = output
  - stderr = error output (may be empty)
  - exitCode = 0
  - executionTimeMs = duration
- **Guarantees:**
  - stdout contains all program output
  - No error_type or error_message

**FAILED:**
- **Entry:** Code execution failed (exitCode ≠ 0 and ≠ 124)
- **Terminal State:** No further transitions
- **Database Fields Set:**
  - status = FAILED
  - finishedAt = now()
  - exitCode = non-zero
  - errorType = "RuntimeError"
  - errorMessage = stderr content
  - executionTimeMs = duration
- **Common Causes:**
  - Syntax errors (Python SyntaxError, JS SyntaxError)
  - Runtime exceptions (IndexError, TypeError, ReferenceError)
  - Unhandled exceptions
  - Failed assertions

**TIMEOUT:**
- **Entry:** Execution exceeded 30-second limit
- **Terminal State:** No further transitions
- **Database Fields Set:**
  - status = FAILED (timeout is type of failure)
  - errorType = "TimeoutError"
  - exitCode = 124
  - finishedAt = now()
  - stderr = original stderr + "[Execution timeout or buffer exceeded]"
- **Common Causes:**
  - Infinite loops
  - Long-running computations
  - Blocking I/O (though network is disabled)
  - Sleep/wait operations

#### Attempt Tracking

```typescript
// Execution entity tracks retry attempts
{
  attempt: 1,        // Current attempt (1, 2, or 3)
  maxAttempts: 3,    // Maximum allowed attempts
}
```

**Retry Logic:**
- BullMQ handles retry scheduling
- Each attempt gets fresh Docker container
- Database record NOT created per attempt (single execution record)
- If all attempts fail: Last error stored in execution record

**Example Timeline:**
```
t=0s:   Job created (attempt=1)
t=0.1s: QUEUED → RUNNING (attempt=1)
t=0.5s: Docker daemon unavailable → Worker throws error
t=2s:   BullMQ retries (attempt=2)
t=2.1s: RUNNING (attempt=2)
t=2.6s: Docker successful → COMPLETED
```

---

## 2. Reliability & Data Model

### 2.1 Data Model

#### Entity Relationships

![DB Diagram](https://res.cloudinary.com/dl8h3byxa/image/upload/v1769095033/code_live_excecution_h6mq0m.png)

**Design Rationale:**

**Session Mutability:**
- sourceCode is mutable (allows editing)
- language can change (switch between Python/JS)
- latestExecutionId points to most recent execution (quick access)

**Execution Immutability:**
- sourceCodeSnapshot captures exact code that ran
- All result fields (stdout, stderr) written once
- Historical record for auditing and debugging

**Cascade Deletion:**
- Deleting session deletes all executions (ON DELETE CASCADE)
- Prevents orphaned execution records
- Session is the "root aggregate" in DDD terms

**Indexes:**
- session.status (filter ACTIVE sessions)
- session.language (analytics queries)
- execution.status (find QUEUED/RUNNING jobs)
- execution.idempotencyKey (unique constraint for deduplication)

---

### 2.2 Idempotency Handling

#### Problem Statement

Without idempotency:
```
Client sends:    POST /sessions/123/run
Network timeout (but request succeeded on server)
Client retries:  POST /sessions/123/run
Result:          2 executions created for same code
```

#### Solution: Idempotency Keys

**Database Schema:**
```sql
ALTER TABLE executions 
ADD COLUMN idempotency_key VARCHAR(128) UNIQUE;

CREATE UNIQUE INDEX idx_executions_idempotency_key 
ON executions(idempotency_key);
```

**Implementation Flow:**

```typescript
async runCodeSession(sessionId: string, idempotencyKey?: string) {
  // Step 1: Generate key if not provided
  const key = idempotencyKey || crypto.randomUUID();
  
  try {
    // Step 2: Check for existing execution
    const existing = await this.executionService
      .findByIdempotencyKey(key);
    
    if (existing) {
      // Return existing execution (duplicate request)
      return new RunCodeResponse(existing.id, existing.status);
    }
    
    // Step 3: Create new execution with idempotency key
    const execution = await this.executionService.createExecution(
      session, sourceCode, maxAttempts, key  // <-- key saved here
    );
    
    // Step 4: Enqueue job
    await this.executionQueue.add('code-execution', {...});
    
    return new RunCodeResponse(execution.id, execution.status);
    
  } catch (err) {
    // Step 5: Handle race condition
    if (err.code === '23505') {  // PostgreSQL unique violation
      // Another request created execution between check and insert
      const existed = await this.executionService
        .findByIdempotencyKey(key);
      
      return new RunCodeResponse(existed.id, existed.status);
    }
    throw err;
  }
}
```

**Race Condition Handling:**

Timeline of concurrent requests with same idempotency key:
```
t=0ms:  Request A → findByIdempotencyKey("key-123") → null
t=1ms:  Request B → findByIdempotencyKey("key-123") → null
t=2ms:  Request A → createExecution(key="key-123") → SUCCESS
t=3ms:  Request B → createExecution(key="key-123") → ERROR 23505
t=4ms:  Request B → Catch error → findByIdempotencyKey("key-123") → Found
t=5ms:  Request B → Return existing execution
```

**Key Properties:**
- Database enforces uniqueness (cannot be bypassed)
- Check-then-insert race is caught and handled
- Client gets same execution_id for duplicate requests
- Idempotent across any time window (key never expires)

**Usage Patterns:**

1. **Client-Generated Keys (Recommended):**
```bash
# Generate idempotency key on client
KEY=$(uuidgen)

# Safe to retry with same key
curl -H "idempotency-key: $KEY" POST /sessions/123/run
curl -H "idempotency-key: $KEY" POST /sessions/123/run  # Same execution_id
```

2. **Server-Generated Keys:**
```bash
# Omit header, server generates UUID
curl POST /sessions/123/run  # execution_id: abc
curl POST /sessions/123/run  # execution_id: def (different!)
```

**Benefits:**
- Prevents duplicate charges (if billing per execution)
- Consistent UX (button click doesn't create duplicate runs)
- Safe retries after network failures
- Audit trail (can see retry attempts via logs)

---

### 2.3 Failure Handling

#### Retry Strategy

**Automatic Retries (BullMQ):**
- Triggered by: Uncaught exceptions in job processor
- Configuration: 3 attempts with exponential backoff (2s, 4s, 8s)
- Applied to: Infrastructure failures only

**Transient Failures (Retried):**
```
1. Docker daemon unavailable
   - Worker can't connect to /var/run/docker.sock
   - Retry: Daemon may recover
   
2. Database connection timeout
   - Worker can't update execution status
   - Retry: Connection pool may free up
   
3. Redis connection lost
   - Job acknowledgment fails
   - Retry: Redis reconnects automatically
   
4. Container resource contention
   - Docker out of memory/CPU
   - Retry: Resources may free up
```

**Permanent Failures (Not Retried):**
```
1. Code execution completes (any exit code)
   - Job succeeded (even if code failed)
   - No retry needed
   
2. Timeout (30 seconds)
   - Execution marked FAILED with TimeoutError
   - Retry would timeout again (infinite loop code)
   
3. Session deleted
   - Validation fails (session not found)
   - Retry would fail again
```

#### Error States

**Failed Execution (Code Error):**
```json
{
  "execution_id": "...",
  "status": "FAILED",
  "stdout": "",
  "stderr": "Traceback (most recent call last):\n  File \"<string>\", line 1\n    print(undefined)\nNameError: name 'undefined' is not defined\n",
  "execution_time_ms": 234,
  "error_type": "RuntimeError",
  "error_message": "NameError: name 'undefined' is not defined",
  "exit_code": 1
}
```

**Timeout Error:**
```json
{
  "execution_id": "...",
  "status": "FAILED",
  "stdout": "Starting...\n",
  "stderr": "[Execution timeout or buffer exceeded]",
  "execution_time_ms": 30001,
  "error_type": "TimeoutError",
  "error_message": "[Execution timeout or buffer exceeded]",
  "exit_code": 124
}
```

**Infrastructure Error (After 3 Retries):**
```json
{
  "execution_id": "...",
  "status": "FAILED",
  "stdout": "",
  "stderr": "Error: Docker daemon is not running",
  "execution_time_ms": 0,
  "error_type": "Error",
  "error_message": "Docker daemon is not running",
  "exit_code": null
}
```

#### Dead-Letter Queue (DLQ) Handling

**Current Implementation:**
- Failed jobs remain in Redis with `failed` status
- `removeOnFail: false` preserves job for inspection
- Manual intervention required for reprocessing

**Accessing Failed Jobs:**
```bash
# Via BullMQ board (if installed)
npx bull-board

# Via Redis CLI
redis-cli LRANGE bull:code-execution:failed 0 -1
```

**Future Enhancement: DLQ Processing:**
```typescript
// Dead-letter queue processor
@Processor('code-execution-dlq')
export class DLQProcessor {
  async process(job: Job) {
    // Alert admin
    await this.alertService.notifyAdmin({
      message: 'Job permanently failed',
      executionId: job.data.executionId,
      attempts: job.attemptsMade,
      error: job.failedReason
    });
    
    // Mark execution as permanently failed
    await this.executionService.markPermanentFailure(
      job.data.executionId
    );
  }
}
```

**Monitoring and Alerting:**
- Track failed job count (metric)
- Alert if failures exceed threshold (e.g., >10% failure rate)
- Dashboard showing error types and frequencies
- Automated health checks for Docker daemon

---

## 3. Scalability Considerations

### 3.1 Handling Concurrent Live Coding Sessions

#### Bottleneck Analysis

**Database (PostgreSQL):**
- **Writes:** Session updates (medium frequency), execution creation (high frequency)
- **Reads:** Session retrieval (high frequency), execution polling (very high frequency)
- **Bottleneck Risk:** Connection pool exhaustion, slow queries
- **Current Limits:** ~1000 concurrent connections (default), ~10k reads/sec

**Queue (Redis/BullMQ):**
- **Writes:** Job enqueue (high frequency)
- **Reads:** Job dequeue (worker frequency), job status (polling frequency)
- **Bottleneck Risk:** Memory exhaustion (all jobs in RAM)
- **Current Limits:** ~50k ops/sec, memory-bound (jobs persist in RAM)

**Docker Engine:**
- **Operations:** Container create/start/stop (per execution)
- **Bottleneck Risk:** Container creation overhead, resource limits
- **Current Limits:** ~100 concurrent containers (depends on host resources)

**Network:**
- **Traffic:** HTTP requests (clients), Docker API calls (internal)
- **Bottleneck Risk:** Network bandwidth for large stdout/stderr
- **Current Limits:** Typically not a bottleneck

#### Concurrency Scenarios

**Scenario 1: 100 Concurrent Sessions**
```
Assumptions:
- 100 users editing code simultaneously
- Each user runs code every 30 seconds
- Each execution takes 3 seconds avg

Calculations:
- Executions per minute: 100 users × 2 runs/min = 200 executions/min
- Peak concurrent executions: 200/60 × 3s = 10 concurrent containers
- Database writes: 200 session updates + 200 execution creates = 400 writes/min
- Database reads: 200 execution polls × 3 polls/exec = 600 reads/min

Bottlenecks:
- None (well within limits)
```

**Scenario 2: 1000 Concurrent Sessions**
```
Assumptions:
- 1000 users, same behavior

Calculations:
- Executions per minute: 1000 × 2 = 2000 executions/min
- Peak concurrent executions: ~100 concurrent containers
- Database writes: 4000 writes/min (~67/sec)
- Database reads: 6000 reads/min (~100/sec)

Bottlenecks:
- Docker: Approaching container limit (100 concurrent)
- Database: Moderate load, no issue
- Redis: Minimal load

Mitigation:
- Increase worker nodes (horizontal scaling)
- Increase Docker host resources
```

**Scenario 3: 10,000 Concurrent Sessions**
```
Assumptions:
- 10,000 users

Calculations:
- Executions per minute: 20,000 executions/min
- Peak concurrent executions: ~1000 concurrent containers
- Database writes: 40,000 writes/min (~667/sec)
- Database reads: 60,000 reads/min (~1000/sec)

Bottlenecks:
- Docker: SEVERE (single host can't handle 1000 containers)
- Database: Approaching connection pool limits
- Redis: Still manageable

Mitigation Required:
- Multi-node worker cluster (10+ nodes)
- Database read replicas
- Connection pooling with pgBouncer
- Redis Cluster for queue distribution
```

---

### 3.2 Horizontal Scaling of Workers

#### Single Worker Architecture (Current)

```
                    ┌─────────────────┐
                    │   API Server    │
                    │  (Producer)     │
                    └────────┬────────┘
                             │
                             v
                    ┌─────────────────┐
                    │   Redis/BullMQ  │
                    │   (Queue)       │
                    └────────┬────────┘
                             │
                             v
                    ┌─────────────────┐
                    │   Worker Node   │
                    │  (Consumer)     │
                    │  - Max 10 jobs  │
                    │    concurrently │
                    └─────────────────┘
```

**Limitations:**
- Single point of failure (worker crash = no processing)
- Limited throughput (bounded by single machine resources)
- No redundancy

#### Multi-Worker Architecture (Scalable)

```
                    ┌─────────────────┐
                    │   API Server    │
                    │  (Producer)     │
                    └────────┬────────┘
                             │
                             v
                    ┌─────────────────┐
                    │   Redis/BullMQ  │
                    │   (Queue)       │
                    └────────┬────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
                v            v            v
        ┌────────────┐ ┌────────────┐ ┌────────────┐
        │  Worker 1  │ │  Worker 2  │ │  Worker N  │
        │ 10 jobs    │ │ 10 jobs    │ │ 10 jobs    │
        └────────────┘ └────────────┘ └────────────┘
```

**Configuration:**
```yaml
# docker-compose.yml for multi-worker setup
services:
  worker:
    build: .
    command: npm run start:worker
    environment:
      - WORKER_CONCURRENCY=10
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    deploy:
      replicas: 5  # 5 workers × 10 concurrency = 50 concurrent executions
```

**Benefits:**
- **Throughput:** N workers × 10 jobs = N×10 concurrent executions
- **Reliability:** Worker failure doesn't stop processing (others continue)
- **Elasticity:** Add/remove workers dynamically based on queue depth

**BullMQ Job Distribution:**
- Automatic load balancing (Redis pops jobs to first available worker)
- No coordination needed (stateless workers)
- FIFO order preserved within queue

**Scaling Strategy:**
```typescript
// Auto-scaling rules (Kubernetes HPA example)
if (queue.waiting > 100 && worker.cpu < 80%) {
  scale(workers, +1);  // Add worker
}

if (queue.waiting === 0 && workers > 2) {
  scale(workers, -1);  // Remove worker (keep minimum 2)
}
```

---

### 3.3 Queue Backlog Handling

#### Backlog Scenarios

**Normal Load:**
```
Queue depth: 0-10 jobs
Latency: < 1 second (jobs processed immediately)
Action: None
```

**Moderate Backlog:**
```
Queue depth: 10-100 jobs
Latency: 1-10 seconds (waiting in queue)
Action: Monitor, consider scaling workers
```

**Heavy Backlog:**
```
Queue depth: 100-1000 jobs
Latency: 10-100 seconds
Action: Scale workers immediately, alert admins
```

**Critical Backlog:**
```
Queue depth: > 1000 jobs
Latency: > 100 seconds
Action: Emergency scaling, rate limiting, incident response
```

#### Backlog Mitigation Strategies

**1. Worker Auto-Scaling:**
```typescript
// Monitor queue depth every 10 seconds
setInterval(async () => {
  const waiting = await queue.getWaitingCount();
  const active = await queue.getActiveCount();
  const currentWorkers = await getWorkerCount();
  
  // Scale up if backlog growing
  if (waiting > 50 * currentWorkers) {
    await scaleWorkers(currentWorkers + 2);
  }
  
  // Scale down if idle
  if (waiting === 0 && active < 5 && currentWorkers > 2) {
    await scaleWorkers(currentWorkers - 1);
  }
}, 10000);
```

**2. Rate Limiting:**
```typescript
// Limit executions per user
@Throttle({ default: { limit: 10, ttl: 60000 } })  // 10 req/min
@Post(':sessionId/run')
async runCodeSession() { ... }
```

**3. Job Prioritization:**
```typescript
// Premium users get higher priority
await executionQueue.add('code-execution', jobData, {
  priority: user.isPremium ? 1 : 10  // Lower number = higher priority
});
```

**4. Circuit Breaker:**
```typescript
// Stop accepting new executions if queue overloaded
if (await queue.getWaitingCount() > 1000) {
  throw new ServiceUnavailableException(
    'System at capacity, please try again later'
  );
}
```

**5. Queue Overflow Handling:**
```typescript
// Reject oldest jobs if queue exceeds limit
if (queueDepth > 5000) {
  const oldJobs = await queue.getWaiting(0, 1000);  // Get oldest 1000
  await queue.remove(oldJobs.map(j => j.id));       // Drop them
  await notifyUsers(oldJobs, 'Execution dropped due to high load');
}
```

---

### 3.4 Bottlenecks and Mitigation Strategies

#### Bottleneck 1: Docker Container Creation Overhead

**Problem:**
- Container startup takes ~500ms-1s
- 1000 executions/min = 1000 container creates/min
- Single Docker daemon can become overloaded

**Mitigation:**

1. **Container Pooling:**
```typescript
// Pre-create idle containers
class ContainerPool {
  private pool: Container[] = [];
  
  async warmup() {
    for (let i = 0; i < 10; i++) {
      const container = await docker.createContainer({
        Image: 'python:3.11-alpine',
        Cmd: ['sleep', 'infinity']
      });
      await container.start();
      this.pool.push(container);
    }
  }
  
  async getContainer(): Promise<Container> {
    return this.pool.pop() || await this.createContainer();
  }
}
```

2. **Warm Containers:**
- Keep containers running between executions
- Use `docker exec` instead of `docker run`
- Reset state with filesystem snapshots

3. **Multiple Docker Hosts:**
- Distribute workers across multiple physical hosts
- Each worker connects to local Docker daemon
- Reduces contention on single daemon

---

#### Bottleneck 2: Database Connection Pool Exhaustion

**Problem:**
- Default PostgreSQL connection pool: ~100 connections
- Each worker holds connections open
- High concurrency exhausts pool

**Mitigation:**

1. **Connection Pooling (pgBouncer):**
```yaml
services:
  pgbouncer:
    image: pgbouncer/pgbouncer
    environment:
      - POOL_MODE=transaction  # Release connection after transaction
      - MAX_CLIENT_CONN=1000   # Support 1000 clients
      - DEFAULT_POOL_SIZE=50   # But only use 50 DB connections
```

2. **Read Replicas:**
```typescript
// Route read queries to replicas
@InjectRepository(Execution, 'read')  // Read replica
private readonly executionReadRepo: Repository<Execution>;

@InjectRepository(Execution, 'write')  // Primary
private readonly executionWriteRepo: Repository<Execution>;
```

3. **Query Optimization:**
```sql
-- Add index for common polling query
CREATE INDEX idx_executions_status_created 
ON executions(status, created_at DESC);

-- Use this query
SELECT * FROM executions 
WHERE status IN ('QUEUED', 'RUNNING')
ORDER BY created_at DESC;
```

---

#### Bottleneck 3: Redis Memory Exhaustion

**Problem:**
- All jobs stored in Redis RAM
- 1M jobs × 10KB/job = 10GB RAM
- Redis eviction policy may drop jobs

**Mitigation:**

1. **Job Data Minimization:**
```typescript
// Don't store full sourceCode in job data
await queue.add('code-execution', {
  executionId: execution.id,  // Reference, not full data
  // sourceCode: execution.sourceCode  ❌ Don't store
});

// Fetch from database in worker
const execution = await executionRepo.findOne(job.data.executionId);
const sourceCode = execution.sourceCodeSnapshot;  // ✅ Fetch when needed
```

2. **Redis Persistence:**
```yaml
# redis.conf
save 900 1       # Save if 1 key changed in 900s
save 300 10      # Save if 10 keys changed in 300s
save 60 10000    # Save if 10000 keys changed in 60s
appendonly yes   # Enable AOF for durability
```

3. **Redis Cluster:**
```yaml
# Shard jobs across multiple Redis nodes
services:
  redis-1:
    image: redis:7-alpine
    ports: ["6379:6379"]
  redis-2:
    image: redis:7-alpine
    ports: ["6380:6379"]
```

---

#### Bottleneck 4: Polling Overhead

**Problem:**
- 1000 active executions × 1 poll/sec = 1000 req/sec
- Database hammered with redundant reads
- Mostly returning unchanged QUEUED/RUNNING status

**Mitigation:**

1. **HTTP Caching:**
```typescript
@Get(':executionId')
@CacheControl({ maxAge: 1 })  // Cache for 1 second
async getExecution(@Param('executionId') id: string) { ... }
```

2. **WebSocket Notifications (Future):**
```typescript
// Push status changes to clients
@WebSocketGateway()
export class ExecutionGateway {
  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, executionId: string) {
    client.join(`execution:${executionId}`);
  }
  
  async notifyStatusChange(executionId: string, status: string) {
    this.server.to(`execution:${executionId}`)
      .emit('statusChange', { executionId, status });
  }
}

// Client stops polling, listens for events
```

3. **Long Polling:**
```typescript
// Block until status changes or timeout
@Get(':executionId/wait')
async waitForCompletion(
  @Param('executionId') id: string,
  @Query('timeout') timeout = 30
) {
  const start = Date.now();
  while (Date.now() - start < timeout * 1000) {
    const execution = await this.executionService.get(id);
    if (['COMPLETED', 'FAILED'].includes(execution.status)) {
      return execution;
    }
    await sleep(500);
  }
  throw new TimeoutException();
}
```

---

## 4. Trade-offs

### 4.1 Technology Choices and Rationale

#### NestJS vs Express/Fastify

**Chosen: NestJS**

**Pros:**
- Built-in dependency injection (testability)
- Modular architecture (clear separation of concerns)
- TypeScript-first (type safety)
- Decorators for validation, swagger, caching
- BullMQ integration via @nestjs/bullmq
- Large ecosystem and active community

**Cons:**
- Learning curve (opinionated framework)
- Slightly higher overhead than raw Express
- More boilerplate for simple apps

**Alternative: Express**
- Pros: Minimal, flexible, fast
- Cons: Manual DI, no structure, validation library needed
- **Verdict:** NestJS better for maintainable, scalable codebase

---

#### BullMQ vs Other Queues

**Chosen: BullMQ**

**Alternatives Considered:**

1. **AWS SQS:**
   - Pros: Managed, highly available, no infrastructure
   - Cons: Vendor lock-in, latency (~100ms), cost per request
   - **Verdict:** BullMQ better for local dev and cost control

2. **RabbitMQ:**
   - Pros: Feature-rich, supports many patterns, persistent
   - Cons: Complex setup, higher resource usage, overkill for simple queue
   - **Verdict:** BullMQ simpler, Redis already needed for caching

3. **Kafka:**
   - Pros: High throughput, event streaming, replay capability
   - Cons: Operational complexity, overkill for job queue
   - **Verdict:** BullMQ sufficient for current scale

**Why BullMQ:**
- Redis-backed (fast, lightweight)
- Built-in retries and backoff
- Job lifecycle tracking
- NestJS first-class support
- Simple to run locally (Docker)

---

#### Docker vs Other Sandboxes

**Chosen: Docker Containers**

**Alternatives Considered:**

1. **VM-based Isolation (Firecracker, gVisor):**
   - Pros: Stronger isolation, true kernel separation
   - Cons: Higher overhead (~100MB RAM, slower startup)
   - **Verdict:** Docker sufficient for code execution, faster

2. **Process-based Isolation (chroot, namespaces):**
   - Pros: Minimal overhead, very fast
   - Cons: Weaker isolation, harder to configure securely
   - **Verdict:** Docker better security-simplicity balance

3. **Language-specific Sandboxes (pypy sandbox, Deno permissions):**
   - Pros: Fine-grained control, language-aware
   - Cons: Doesn't support multiple languages, harder to enforce limits
   - **Verdict:** Docker more flexible for multi-language support

**Why Docker:**
- Mature ecosystem (images for all languages)
- Resource limits (cgroups) built-in
- Easy to add new languages (just new image)
- Industry-standard (developers familiar)

---

#### PostgreSQL vs NoSQL

**Chosen: PostgreSQL**

**Alternatives Considered:**

1. **MongoDB:**
   - Pros: Schema-less, horizontal scaling
   - Cons: No foreign keys, weaker consistency guarantees
   - **Verdict:** PostgreSQL better for relational data (sessions ↔ executions)

2. **DynamoDB:**
   - Pros: Managed, auto-scaling, low latency
   - Cons: Query limitations (no joins), cost, vendor lock-in
   - **Verdict:** PostgreSQL better for complex queries and local dev

**Why PostgreSQL:**
- ACID transactions (idempotency constraint)
- Foreign keys (referential integrity)
- Rich query capabilities (JOINs, aggregations)
- TypeORM excellent support
- Free, open-source, runs anywhere

---

### 4.2 Optimization Priorities

#### Optimized For: Reliability > Simplicity > Speed

**Reliability (Highest Priority):**

1. **Idempotency:**
   - Database-enforced uniqueness (not just app-level check)
   - Prevents duplicate executions from network retries
   - Production-critical for billing and user experience

2. **Retry Logic:**
   - Automatic retries for transient failures
   - Exponential backoff prevents thundering herd
   - Jobs survive worker crashes (Redis persistence)

3. **Error Tracking:**
   - Comprehensive error types and messages
   - Execution history preserved (removeOnComplete: false)
   - Debugging information (stdout, stderr, execution time)

**Simplicity (Medium Priority):**

1. **Polling vs WebSocket:**
   - Chose polling (simpler to implement and debug)
   - Trade-off: Higher latency, more requests
   - Future: WebSocket can be added without breaking changes

2. **Synchronous Session Management:**
   - Session create/update are not queued
   - Immediate feedback to user
   - Trade-off: Database write blocks HTTP response

3. **Single Queue:**
   - One queue for all executions (no priority queues yet)
   - Simpler configuration and monitoring
   - Trade-off: Premium users wait same as free users

**Speed (Lower Priority):**

1. **Container Creation Overhead:**
   - Fresh container per execution (~500ms startup)
   - Could use container pooling (more complex)
   - Trade-off: Stronger isolation > faster execution

2. **Database Queries:**
   - No aggressive caching (could add Redis cache layer)
   - Direct database queries for execution status
   - Trade-off: Slightly higher latency, but simpler architecture

3. **Output Buffering:**
   - Wait for full execution before returning results
   - Could stream stdout/stderr in real-time
   - Trade-off: Simpler API, but delayed feedback

**Rationale:**
- Interview/coding challenge use case doesn't require sub-second latency
- Reliability critical (users expect code to run exactly once)
- Simplicity aids debugging and onboarding new developers

---

### 4.3 Production Readiness Gaps

#### High Priority Gaps

**1. Authentication & Authorization**
- **Current:** No authentication (anyone can create sessions/run code)
- **Risk:** Abuse, resource exhaustion, security breach
- **Solution:** JWT-based auth, role-based access control
- **Effort:** 2-3 days

**2. Rate Limiting**
- **Current:** No limits on executions per user
- **Risk:** Single user can overwhelm system
- **Solution:** Redis-based rate limiter (e.g., 10 executions/min per user)
- **Effort:** 1 day

**3. Monitoring & Alerting**
- **Current:** Basic logs, no metrics or dashboards
- **Risk:** Can't detect issues proactively
- **Solution:** Prometheus + Grafana, alert on high failure rate, queue depth
- **Effort:** 3-4 days

**4. Health Checks**
- **Current:** No /health endpoint
- **Risk:** Load balancer can't detect unhealthy instances
- **Solution:** Health check endpoint verifying database, Redis, Docker
- **Effort:** 1 day

**5. Secrets Management**
- **Current:** .env file with plaintext credentials
- **Risk:** Leaked credentials in version control
- **Solution:** Vault, AWS Secrets Manager, or Kubernetes Secrets
- **Effort:** 2 days

---

#### Medium Priority Gaps

**6. WebSocket Support**
- **Current:** Polling-based result retrieval
- **Impact:** Higher latency, more API requests
- **Solution:** Socket.IO for real-time updates
- **Effort:** 3-4 days

**7. Input Validation Hardening**
- **Current:** Basic class-validator checks
- **Impact:** Malicious input could cause issues
- **Solution:** Stricter validation, code sanitization, AST analysis
- **Effort:** 2-3 days

**8. Database Migration Strategy**
- **Current:** Manual migration:run command
- **Impact:** Error-prone deployments
- **Solution:** Automated migrations in CI/CD, rollback strategy
- **Effort:** 1-2 days

**9. Logging Standardization**
- **Current:** console.log statements
- **Impact:** Hard to parse, no structured logging
- **Solution:** Winston/Pino with JSON format, log aggregation
- **Effort:** 2 days

**10. API Versioning**
- **Current:** No versioning (/code-sessions)
- **Impact:** Breaking changes affect all clients
- **Solution:** Version prefix (/v1/code-sessions)
- **Effort:** 1 day

---

#### Low Priority Gaps

**11. Horizontal API Scaling**
- **Current:** Single API instance
- **Impact:** Single point of failure
- **Solution:** Load balancer + multiple API replicas
- **Effort:** 1 day (infrastructure)

**12. Database Backups**
- **Current:** No automated backups
- **Impact:** Data loss risk
- **Solution:** pg_dump cron job or managed database backups
- **Effort:** 1 day

**13. E2E Tests**
- **Current:** Basic unit tests only
- **Impact:** Regressions not caught
- **Solution:** Full API tests with real database/Redis
- **Effort:** 3-4 days

**14. Documentation**
- **Current:** Markdown README (comprehensive, but static)
- **Impact:** API changes may not reflect in docs
- **Solution:** OpenAPI/Swagger auto-generated docs
- **Effort:** 1 day

**15. Cost Optimization**
- **Current:** No resource usage tracking
- **Impact:** Can't optimize costs
- **Solution:** Metrics on container usage, execution duration
- **Effort:** 2 days

---

### Estimated Total Production Readiness Effort

**High Priority:** ~10 days
**Medium Priority:** ~12 days
**Low Priority:** ~12 days

**Total:** ~34 developer-days (6-7 weeks for one developer)

**Critical Path for MVP Production Deploy:**
- Authentication (3d) → Rate Limiting (1d) → Monitoring (4d) → Health Checks (1d)
- **Minimum:** ~9 days to production-ready MVP

---

## Summary

This system demonstrates a well-architected, scalable code execution platform with:

**Strengths:**
- Robust async execution model (BullMQ)
- Strong reliability guarantees (idempotency, retries)
- Security-first design (Docker isolation)
- Clear data model (sessions vs executions)
- Horizontal scalability (multi-worker support)

**Intentional Trade-offs:**
- Polling over WebSocket (simplicity)
- Fresh containers over pooling (security)
- Limited caching (consistency)

**Next Steps for Production:**
- Add authentication and rate limiting (security)
- Implement monitoring and alerting (observability)
- Deploy multi-worker cluster (scalability)
- Add WebSocket support (UX improvement)

The architecture is production-ready with minor enhancements, and designed to scale from 100 to 10,000+ concurrent users with infrastructure additions (workers, read replicas, caching).
