import { v4 as uuidv4 } from 'uuid';
import type {
  Task,
  Plan,
  PlanStep,
  GeneratedArtifact,
  Evaluation,
  FinalEvaluation,
  OrchestratorConfig,
  ObservationHandler,
} from './types.js';
import { PlannerAgent, GeneratorAgent, EvaluatorAgent } from './agents/index.js';
import { Workspace, WorkspaceFactory } from './workspace/index.js';
import { Logger, ProgressTracker } from './observability/index.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

export interface OrchestratorOptions {
  workspaceDir?: string;
  config?: Partial<OrchestratorConfig>;
  authToken?: string;
}

export interface TaskResult {
  success: boolean;
  taskId: string;
  plan?: Plan;
  artifacts: GeneratedArtifact[];
  evaluations: Evaluation[];
  finalEvaluation?: FinalEvaluation;
  error?: string;
}

/**
 * Orchestrator drives the multi-agent workflow to complete tasks.
 *
 * Flow:
 * 1. Create plan using PlannerAgent
 * 2. For each step:
 *    a. Generate artifact using GeneratorAgent
 *    b. Evaluate using EvaluatorAgent
 *    c. If failed and retries remain, regenerate
 * 3. Final evaluation of completed task
 * 4. Complete task
 */
export class Orchestrator {
  private planner: PlannerAgent;
  private generator: GeneratorAgent;
  private evaluator: EvaluatorAgent;
  private workspaceFactory: WorkspaceFactory;
  private config: OrchestratorConfig;
  private logger: Logger;
  private progress: ProgressTracker;

  constructor(options: OrchestratorOptions = {}) {
    this.config = {
      maxIterations: options.config?.maxIterations ?? 10,
      autoRetryOnFailure: options.config?.autoRetryOnFailure ?? true,
      maxRetriesPerStep: options.config?.maxRetriesPerStep ?? 2,
      enableObservation: options.config?.enableObservation ?? true,
    };

    const agentConfig = { authToken: options.authToken };
    this.planner = new PlannerAgent(agentConfig);
    this.generator = new GeneratorAgent(agentConfig);
    this.evaluator = new EvaluatorAgent(agentConfig);

    this.workspaceFactory = new WorkspaceFactory(options.workspaceDir ?? './workspaces');
    this.logger = new Logger({ logToConsole: true, logToFile: true });
    this.progress = new ProgressTracker(this.logger);
  }

  /**
   * Subscribe to observation events
   */
  onObservation(handler: ObservationHandler): () => void {
    return this.logger.onEvent(handler);
  }

  /**
   * Execute a task end-to-end
   */
  async executeTask(description: string, requirements: string[]): Promise<TaskResult> {
    const taskId = uuidv4();
    const task: Task = {
      id: taskId,
      description,
      requirements,
      createdAt: new Date(),
    };

    // Create workspace
    const workspace = await this.workspaceFactory.createWorkspace(taskId);
    await workspace.saveTask(task);

    try {
      await this.logger.log({
        type: 'step_started',
        taskId,
        timestamp: new Date(),
        message: `Starting task: ${description}`,
      });

      // Step 1: Create plan
      const planResult = await this.planner.createPlan(task);
      if (!planResult.success || !planResult.data) {
        const error = planResult.error ?? 'Planning failed';
        await this.logger.logError(taskId, error);
        await workspace.updateStatus('planning_failed');
        return { success: false, taskId, artifacts: [], evaluations: [], error };
      }

      const plan = planResult.data;
      await workspace.savePlan(plan);
      await this.logger.logPlanCreated(taskId, plan.steps.length);
      this.progress.startTask(taskId, plan.steps.length);

      // Execute each step
      const artifacts: GeneratedArtifact[] = [];
      const evaluations: Evaluation[] = [];

      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        const result = await this.executeStep(task, step, workspace, artifacts);

        if (result.artifact) artifacts.push(result.artifact);
        if (result.evaluation) evaluations.push(result.evaluation);

        if (!result.success) {
          const error = result.error ?? `Step ${step.id} failed`;
          await this.logger.logError(taskId, error, step.id);
          await workspace.updateStatus('failed');
          return { success: false, taskId, plan, artifacts, evaluations, error };
        }

        this.progress.completeStep();
      }

      // Final evaluation: Check completed task against original requirements
      console.log('\n🎯 Running final evaluation...\n');
      const finalEval = await this.performFinalEvaluation(task, workspace);

      // Task completed
      await workspace.updateStatus('completed');
      await this.logger.logTaskCompleted(taskId, finalEval.passed);

      return {
        success: finalEval.passed,
        taskId,
        plan,
        artifacts,
        evaluations,
        finalEvaluation: finalEval,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.logger.logError(taskId, errorMsg);
      await workspace.updateStatus('error');
      return { success: false, taskId, artifacts: [], evaluations: [], error: errorMsg };
    }
  }

  /**
   * Perform final evaluation of the completed task against original requirements
   */
  private async performFinalEvaluation(
    task: Task,
    workspace: Workspace
  ): Promise<FinalEvaluation> {
    const startTime = Date.now();

    const q = query({
      prompt: `<system>
You are a final evaluator. Your job is to assess whether the COMPLETED TASK meets ALL original requirements.

This is the FINAL VERIFICATION stage. Be thorough and critical.

Evaluation criteria:
1. Does the final output satisfy ALL original requirements?
2. Is the implementation complete and functional?
3. Is the code quality production-ready?
4. Are there any gaps or missing elements?

Use the Glob, Read, and Bash tools to thoroughly examine the workspace and verify everything is complete.
DO NOT rely on summaries - verify the actual files.

Respond ONLY with a JSON object in this format:
{
  "passed": true/false,
  "score": 0-100,
  "feedback": "Comprehensive assessment of the completed work",
  "requirementsMet": [
    {
      "requirement": "requirement text",
      "met": true/false,
      "evidence": "Evidence from actual files"
    }
  ],
  "suggestions": ["improvement suggestion 1", "improvement suggestion 2"]
}

A task passes only if ALL requirements are met with quality >= 80.
</system>

Evaluate the COMPLETED TASK against original requirements:

TASK DESCRIPTION:
${task.description}

REQUIREMENTS:
${task.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

IMPORTANT: Use tools to examine the actual files in the workspace. Verify ALL requirements are met.`,
      options: {
        model: 'claude-opus-4-6-20251001',
        cwd: workspace.basePath,
        allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
      },
    });

    let evalContent = '';

    for await (const message of q) {
      if (message.type === 'assistant') {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              evalContent += block.text;
            }
          }
        }
      } else if (message.type === 'result' && message.subtype === 'success') {
        if (message.result) {
          evalContent = message.result;
        }
      }
    }

    const evalData = this.extractFinalEvalJson(evalContent);

    const finalEvaluation: FinalEvaluation = {
      taskId: task.id,
      passed: evalData.passed,
      score: evalData.score,
      feedback: evalData.feedback,
      requirementsMet: evalData.requirementsMet || [],
      suggestions: evalData.suggestions || [],
      evaluatedAt: new Date(),
    };

    // Log the final evaluation
    await this.logger.logFinalEvaluation(
      task.id,
      finalEvaluation.passed,
      finalEvaluation.score,
      finalEvaluation.feedback
    );

    // Save final evaluation to workspace
    await workspace.writeContext('final_evaluation.json', finalEvaluation);

    return finalEvaluation;
  }

  private extractFinalEvalJson(content: string): {
    passed: boolean;
    score: number;
    feedback: string;
    requirementsMet: { requirement: string; met: boolean; evidence: string }[];
    suggestions?: string[];
  } {
    // Try to extract JSON from markdown code blocks first
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1]);
    }

    // Fall back to finding raw JSON object
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in final evaluation response');
    }
    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStep(
    task: Task,
    step: PlanStep,
    workspace: Workspace,
    previousArtifacts: GeneratedArtifact[],
    attempt: number = 1
  ): Promise<{
    success: boolean;
    artifact?: GeneratedArtifact;
    evaluation?: Evaluation;
    error?: string;
  }> {
    await this.logger.logStepStarted(task.id, step.id, step.description);
    step.status = 'in_progress';
    await workspace.savePlan(await this.loadPlan(workspace)!);

    // Generate artifact (pass workspace path so tools operate in correct directory)
    const genResult = await this.generator.generate(task, step, previousArtifacts, workspace.basePath);
    if (!genResult.success || !genResult.data) {
      const error = genResult.error ?? 'Generation failed';
      await this.logger.logStepFailed(task.id, step.id, error, attempt < this.config.maxRetriesPerStep);

      if (this.config.autoRetryOnFailure && attempt < this.config.maxRetriesPerStep) {
        await this.logger.log({
          type: 'step_started',
          taskId: task.id,
          stepId: step.id,
          timestamp: new Date(),
          message: `Retrying step ${step.id} (attempt ${attempt + 1}/${this.config.maxRetriesPerStep})`,
        });
        return this.executeStep(task, step, workspace, previousArtifacts, attempt + 1);
      }

      step.status = 'failed';
      return { success: false, error };
    }

    const artifact = genResult.data;
    await workspace.saveArtifact(artifact);

    // Evaluate artifact (pass workspace path so evaluator can read actual files)
    const evalResult = await this.evaluator.evaluate(task, step, artifact, workspace.basePath);
    if (!evalResult.success || !evalResult.data) {
      const error = evalResult.error ?? 'Evaluation failed';
      await this.logger.logStepFailed(task.id, step.id, error, false);
      return { success: false, artifact, error };
    }

    const evaluation = evalResult.data;
    await workspace.saveEvaluation(evaluation);
    await this.logger.logEvaluationCompleted(
      task.id,
      step.id,
      evaluation.passed,
      evaluation.score,
      evaluation.feedback
    );

    if (!evaluation.passed) {
      await this.logger.logStepFailed(
        task.id,
        step.id,
        `Quality score too low: ${evaluation.score}`,
        attempt < this.config.maxRetriesPerStep
      );

      if (this.config.autoRetryOnFailure && attempt < this.config.maxRetriesPerStep) {
        await this.logger.log({
          type: 'step_started',
          taskId: task.id,
          stepId: step.id,
          timestamp: new Date(),
          message: `Regenerating step ${step.id} based on feedback (attempt ${attempt + 1}/${this.config.maxRetriesPerStep})`,
        });
        return this.executeStep(task, step, workspace, previousArtifacts, attempt + 1);
      }

      step.status = 'failed';
      return {
        success: false,
        artifact,
        evaluation,
        error: `Step failed quality check: ${evaluation.feedback}`,
      };
    }

    step.status = 'completed';
    await this.logger.logStepCompleted(task.id, step.id);

    return { success: true, artifact, evaluation };
  }

  private async loadPlan(workspace: Workspace): Promise<Plan | null> {
    return workspace.loadPlan();
  }

  /**
   * Resume a task from a workspace
   */
  async resumeTask(taskId: string): Promise<{
    success: boolean;
    artifacts: GeneratedArtifact[];
    evaluations: Evaluation[];
    finalEvaluation?: FinalEvaluation;
    error?: string;
  }> {
    const workspace = this.workspaceFactory.loadWorkspace(taskId);
    const task = await workspace.loadTask();
    const plan = await workspace.loadPlan();

    if (!task || !plan) {
      return { success: false, artifacts: [], evaluations: [], error: 'Task or plan not found' };
    }

    // Resume from current position
    const artifacts = await workspace.listArtifacts();
    const evaluations = await workspace.listEvaluations();

    // Find next incomplete step
    const currentStepIndex = plan.steps.findIndex((s) => s.status !== 'completed');
    if (currentStepIndex === -1) {
      // All steps complete, run final evaluation if not already done
      const existingFinalEval = await workspace.readContext<FinalEvaluation>('final_evaluation.json');
      if (existingFinalEval) {
        return { success: existingFinalEval.passed, artifacts, evaluations, finalEvaluation: existingFinalEval };
      }

      // Run final evaluation
      const finalEval = await this.performFinalEvaluation(task, workspace);
      return { success: finalEval.passed, artifacts, evaluations, finalEvaluation: finalEval };
    }

    this.progress.startTask(taskId, plan.steps.length - currentStepIndex);

    for (let i = currentStepIndex; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      // Use current workspace to maintain context
      const result = await this.executeStep(task, step, workspace, artifacts);

      if (result.artifact) artifacts.push(result.artifact);
      if (result.evaluation) evaluations.push(result.evaluation);

      if (!result.success) {
        return { success: false, artifacts, evaluations, error: result.error };
      }

      this.progress.completeStep();
    }

    // Run final evaluation after all steps complete
    const finalEval = await this.performFinalEvaluation(task, workspace);

    await workspace.updateStatus('completed');
    await this.logger.logTaskCompleted(taskId, finalEval.passed);

    return { success: finalEval.passed, artifacts, evaluations, finalEvaluation: finalEval };
  }
}
