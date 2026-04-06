import { BaseAgent } from './BaseAgent.js';
import type { Task, PlanStep, GeneratedArtifact, AgentResult, AgentConfig } from '../types.js';

export class GeneratorAgent extends BaseAgent {
  constructor(config: AgentConfig = {}) {
    super('generator', config);
  }

  async generate(
    task: Task,
    step: PlanStep,
    previousArtifacts: GeneratedArtifact[],
    workspacePath?: string
  ): Promise<AgentResult<GeneratedArtifact>> {
    const startTime = Date.now();

    try {
      const systemPrompt = `You are an implementation agent. Your job is to execute a specific step of a plan by ACTUALLY CREATING FILES.

IMPORTANT - YOU MUST USE TOOLS:
1. Use the Edit, Write, and Bash tools to ACTUALLY CREATE FILES in the workspace
2. Do NOT just describe what should be done - actually do it
3. Create real files with real content
4. Use Bash to run commands like npm install
5. Verify your work was completed by reading back files you created

Guidelines:
1. Focus only on the current step - don't try to solve the entire task
2. Produce high-quality, well-structured output
3. Write clean, documented code
4. Be thorough and complete

Your response should summarize what files you created and what was done.`;

      const contextFromPrevious = previousArtifacts.length > 0
        ? `\n\nPrevious work completed:\n${previousArtifacts.map((a) => `\n--- ${a.stepId} ---\n${a.content}`).join('\n')}`
        : '';

      const userPrompt = `Execute this step of the overall task:

OVERALL TASK:
${task.description}

REQUIREMENTS:
${task.requirements.map((r) => `- ${r}`).join('\n')}

YOUR STEP (${step.id}):
${step.description}

EXPECTED OUTPUT:
${step.expectedOutput}

${step.dependencies.length > 0 ? `THIS STEP DEPENDS ON: ${step.dependencies.join(', ')}` : ''}
${contextFromPrevious}

IMPORTANT: Actually create the files using the Edit/Write tools. Do not just describe what should be done.`;

      const response = await this.callLLM(systemPrompt, userPrompt, workspacePath);

      const artifact: GeneratedArtifact = {
        stepId: step.id,
        content: response.content,
        metadata: {
          generatedAt: new Date(),
          model: this.model,
          tokensUsed: response.usage ? response.usage.input_tokens + response.usage.output_tokens : undefined,
        },
      };

      return this.createResult(true, artifact, undefined, startTime);
    } catch (error) {
      return this.createResult(false, undefined, `Generation failed: ${error}`, startTime);
    }
  }
}
