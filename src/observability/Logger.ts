import { writeFile, mkdir, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { ObservationEvent, ObservationHandler } from '../types.js';

export interface LoggerConfig {
  logToConsole?: boolean;
  logToFile?: boolean;
  logDir?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Logger provides observability for the harness system
 */
export class Logger {
  private config: Required<LoggerConfig>;
  private handlers: Set<ObservationHandler> = new Set();

  constructor(config: LoggerConfig = {}) {
    this.config = {
      logToConsole: config.logToConsole ?? true,
      logToFile: config.logToFile ?? true,
      logDir: config.logDir ?? './logs',
      logLevel: config.logLevel ?? 'info',
    };
  }

  /**
   * Subscribe to observation events
   */
  onEvent(handler: ObservationHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Log an observation event
   */
  async log(event: ObservationEvent): Promise<void> {
    if (this.shouldLog(event.type)) {
      if (this.config.logToConsole) {
        this.logToConsole(event);
      }
      if (this.config.logToFile) {
        await this.logToFile(event);
      }
    }

    // Notify all handlers
    this.handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (e) {
        console.error('Observation handler failed:', e);
      }
    });
  }

  /**
   * Log plan creation
   */
  async logPlanCreated(taskId: string, stepCount: number): Promise<void> {
    await this.log({
      type: 'plan_created',
      taskId,
      timestamp: new Date(),
      message: `Plan created with ${stepCount} steps`,
      details: { stepCount },
    });
  }

  /**
   * Log step start
   */
  async logStepStarted(taskId: string, stepId: string, description: string): Promise<void> {
    await this.log({
      type: 'step_started',
      taskId,
      stepId,
      timestamp: new Date(),
      message: `Starting step: ${description}`,
      details: { description },
    });
  }

  /**
   * Log step completion
   */
  async logStepCompleted(taskId: string, stepId: string): Promise<void> {
    await this.log({
      type: 'step_completed',
      taskId,
      stepId,
      timestamp: new Date(),
      message: `Step ${stepId} completed`,
    });
  }

  /**
   * Log step failure
   */
  async logStepFailed(
    taskId: string,
    stepId: string,
    error: string,
    willRetry: boolean
  ): Promise<void> {
    await this.log({
      type: 'step_failed',
      taskId,
      stepId,
      timestamp: new Date(),
      message: `Step ${stepId} failed: ${error}`,
      details: { error, willRetry },
    });
  }

  /**
   * Log evaluation completion
   */
  async logEvaluationCompleted(
    taskId: string,
    stepId: string,
    passed: boolean,
    score: number,
    feedback: string
  ): Promise<void> {
    await this.log({
      type: 'evaluation_completed',
      taskId,
      stepId,
      timestamp: new Date(),
      message: `Evaluation: ${passed ? 'PASSED' : 'FAILED'} (score: ${score})`,
      details: { passed, score, feedback },
    });
  }

  /**
   * Log task completion
   */
  async logTaskCompleted(taskId: string, success: boolean): Promise<void> {
    await this.log({
      type: 'task_completed',
      taskId,
      timestamp: new Date(),
      message: `Task ${success ? 'completed successfully' : 'failed'}`,
      details: { success },
    });
  }

  /**
   * Log error
   */
  async logError(taskId: string, error: string, stepId?: string): Promise<void> {
    await this.log({
      type: 'error',
      taskId,
      stepId,
      timestamp: new Date(),
      message: `Error: ${error}`,
      details: { error },
    });
  }

  private shouldLog(eventType: ObservationEvent['type']): boolean {
    const levels: Record<string, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    const eventLevel: Record<ObservationEvent['type'], string> = {
      plan_created: 'info',
      step_started: 'info',
      step_completed: 'info',
      step_failed: 'error',
      evaluation_completed: 'info',
      final_evaluation_completed: 'info',
      task_completed: 'info',
      error: 'error',
    };

    return levels[eventLevel[eventType]] >= levels[this.config.logLevel];
  }

  private logToConsole(event: ObservationEvent): void {
    const emoji = this.getEmoji(event.type);
    const timestamp = event.timestamp.toISOString();
    const stepInfo = event.stepId ? ` [${event.stepId}]` : '';

    const message = `${emoji} [${timestamp}]${stepInfo} ${event.message}`;

    if (event.type === 'error' || event.type === 'step_failed') {
      console.error(message);
    } else {
      console.log(message);
    }

    if (event.details && this.config.logLevel === 'debug') {
      console.log('   Details:', JSON.stringify(event.details, null, 2));
    }
  }

  private async logToFile(event: ObservationEvent): Promise<void> {
    if (!existsSync(this.config.logDir)) {
      await mkdir(this.config.logDir, { recursive: true });
    }

    const dateStr = event.timestamp.toISOString().split('T')[0];
    const logFile = join(this.config.logDir, `${dateStr}_${event.taskId}.log`);

    const line = JSON.stringify({
      ...event,
      timestamp: event.timestamp.toISOString(),
    }) + '\n';

    await appendFile(logFile, line, 'utf-8');
  }

  /**
   * Log final evaluation completion
   */
  async logFinalEvaluation(
    taskId: string,
    passed: boolean,
    score: number,
    feedback: string
  ): Promise<void> {
    await this.log({
      type: 'final_evaluation_completed',
      taskId,
      timestamp: new Date(),
      message: `Final Evaluation: ${passed ? 'PASSED' : 'FAILED'} (score: ${score})`,
      details: { passed, score, feedback },
    });
  }

  private getEmoji(type: ObservationEvent['type']): string {
    const emojis: Record<ObservationEvent['type'], string> = {
      plan_created: '📋',
      step_started: '▶️',
      step_completed: '✅',
      step_failed: '❌',
      evaluation_completed: '📝',
      final_evaluation_completed: '🎯',
      task_completed: '🏁',
      error: '🔥',
    };
    return emojis[type];
  }
}

/**
 * Progress tracker for real-time task progress
 */
export class ProgressTracker {
  private logger: Logger;
  private currentTask?: string;
  private totalSteps: number = 0;
  private completedSteps: number = 0;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  startTask(taskId: string, stepCount: number): void {
    this.currentTask = taskId;
    this.totalSteps = stepCount;
    this.completedSteps = 0;
    console.log(`\n🚀 Starting task ${taskId} (${stepCount} steps)\n`);
  }

  completeStep(): void {
    this.completedSteps++;
    const percent = Math.round((this.completedSteps / this.totalSteps) * 100);
    const bar = this.renderProgressBar(percent);
    console.log(`${bar} ${percent}% (${this.completedSteps}/${this.totalSteps})`);
  }

  private renderProgressBar(percent: number): string {
    const width = 30;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return '│' + '█'.repeat(filled) + '░'.repeat(empty) + '│';
  }
}
