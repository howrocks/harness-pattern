# Harness System for Long-Running Applications

A TypeScript implementation of the [Anthropic harness pattern](https://www.anthropic.com/engineering/harness-design-long-running-apps) for building complex, multi-step workflows with autonomous agents.

Uses **Claude Opus 4.6** via the **Anthropic Agent SDK** with local Claude Code authentication.

## Architecture

The system consists of:

- **Orchestrator**: Drives the task completion workflow, coordinating between agents
- **Planner Agent**: Breaks down tasks into executable steps
- **Generator Agent**: Executes each step to produce artifacts
- **Evaluator Agent**: Critically assesses artifacts against requirements
- **Workspace**: Provides isolated task environments with filesystem-based context exchange
- **Observability**: Real-time logging and progress tracking

## Installation

```bash
npm install
npm run build
```

## Authentication

This harness **automatically uses your local Claude Code authentication** - no manual configuration needed!

The system will automatically:
1. Detect your local Claude Code installation
2. Retrieve the auth token from `claude config get agent.authToken`
3. Use it for all Agent SDK calls

If you need to override the automatic detection:
```bash
export ANTHROPIC_AUTH_TOKEN="your-auth-token"
```

Or pass it directly:
```typescript
const orchestrator = new Orchestrator({
  authToken: 'your-auth-token'
});
```

## Quick Start

```typescript
import { Orchestrator } from './src/index.js';

const orchestrator = new Orchestrator();

const result = await orchestrator.executeTask(
  'Create a React counter component',
  [
    'Include increment/decrement buttons',
    'Display the current count',
    'Use TypeScript with proper types',
    'Add styling with CSS'
  ]
);

console.log(result.success);     // true/false
console.log(result.artifacts);   // Generated content
console.log(result.evaluations); // Quality scores
```

## Configuration

```typescript
const orchestrator = new Orchestrator({
  workspaceDir: './workspaces',     // Where task workspaces are stored
  config: {
    maxIterations: 10,              // Max total steps
    autoRetryOnFailure: true,       // Retry failed steps
    maxRetriesPerStep: 2,           // Retry attempts per step
    enableObservation: true,        // Enable event logging
  },
  // authToken is auto-detected from Claude Code, override if needed:
  // authToken: 'custom-auth-token'
});
```

## Model

Default model: **Claude Opus 4.6** (`claude-opus-4-6-20251001`)

You can override this in agent config:
```typescript
const agentConfig = {
  model: 'claude-opus-4-6-20251001',
  maxTokens: 8192,
  temperature: 0.2,
};
```

## Observing Execution

Subscribe to execution events:

```typescript
orchestrator.onObservation((event) => {
  console.log(`${event.type}: ${event.message}`);
  // Send to dashboard, database, etc.
});
```

Events include: `plan_created`, `step_started`, `step_completed`, `step_failed`, `evaluation_completed`, `task_completed`, `error`

## Project Structure

```
src/
├── Orchestrator.ts           # Main workflow controller
├── types.ts                  # TypeScript interfaces
├── agents/
│   ├── BaseAgent.ts          # LLM communication via Agent SDK
│   ├── PlannerAgent.ts       # Creates execution plans
│   ├── GeneratorAgent.ts     # Produces artifacts
│   └── EvaluatorAgent.ts     # Quality assessment
├── workspace/
│   └── Workspace.ts          # Task isolation & context exchange
└── observability/
    └── Logger.ts             # Progress tracking & logging
```

## Workflow

1. **Planning**: Planner Agent breaks the task into steps
2. **Generation**: Generator Agent executes each step
3. **Evaluation**: Evaluator Agent checks quality (pass/fail + score)
4. **Retry**: Failed steps are regenerated with feedback (configurable)
5. **Completion**: All steps complete → task done

## Workspace

Each task gets an isolated workspace at `./workspaces/{taskId}/`:

```
workspaces/
└── {taskId}/
    ├── context/
    │   ├── metadata.json       # Task metadata
    │   ├── task.json           # Task definition
    │   ├── plan.json           # Execution plan
    │   ├── artifacts/          # Generated content
    │   └── evaluations/        # Quality assessments
    └── logs/                   # Execution logs
```

## Running Examples

```bash
# Full example with detailed output
npm run example

# Or directly
npx tsx examples/example.ts

# Simple example
npx tsx examples/simple.ts
```

## API Reference

### Orchestrator

- `executeTask(description, requirements)` - Execute a complete task
- `resumeTask(taskId)` - Resume a partially completed task
- `onObservation(handler)` - Subscribe to execution events

### Agents

All agents extend `BaseAgent` and accept:
- `authToken` - Anthropic auth token from Claude Code
- `model` - Model to use (default: claude-opus-4-6-20251001)
- `maxTokens` - Max tokens per request
- `temperature` - Sampling temperature

## License

MIT
