import { query } from '@anthropic-ai/claude-agent-sdk';
import { BaseAgent } from './BaseAgent.js';
import type { Task, PlanStep, GeneratedArtifact, Evaluation, AgentResult, AgentConfig } from '../types.js';

export class EvaluatorAgent extends BaseAgent {
  constructor(config: AgentConfig = {}) {
    super('evaluator', config);
  }

  async evaluate(
    task: Task,
    step: PlanStep,
    artifact: GeneratedArtifact,
    workspacePath?: string
  ): Promise<AgentResult<Evaluation>> {
    const startTime = Date.now();

    try {
      // Use query() with Read tool to actually check files in the workspace
      const q = query({
        prompt: `<system>
You are an evaluation agent. Your job is to critically assess whether the step was completed successfully by READING THE ACTUAL FILES in the workspace.

Evaluation criteria:
1. Does it satisfy the expected output for the step?
2. Does it meet the overall task requirements?
3. Is the quality high (complete, accurate, well-structured)?
4. Are there any issues or missing elements?

Use the Read and Glob tools to examine the actual files created in the workspace.
DO NOT rely on summaries - verify the actual file contents.

Respond ONLY with a JSON object in this format:
{
  "passed": true/false,
  "score": 0-100,
  "feedback": "Detailed feedback on what was done well and what needs improvement",
  "suggestions": ["specific suggestion 1", "specific suggestion 2"]
}

Be objective and thorough. A score below 80 or "passed: false" means the step should be retried.
</system>

Evaluate this step completion:

OVERALL TASK:
${task.description}

TASK REQUIREMENTS:
${task.requirements.map((r) => `- ${r}`).join('\n')}

STEP BEING EVALUATED (${step.id}):
${step.description}

EXPECTED OUTPUT FOR THIS STEP:
${step.expectedOutput}

ARTIFACT SUMMARY:
${artifact.content.substring(0, 500)}${artifact.content.length > 500 ? '...' : ''}

IMPORTANT: Use the Glob and Read tools to find and examine the actual files in the workspace to verify the step was completed correctly. Do not rely on the artifact summary alone.`,
        options: {
          model: this.model,
          cwd: workspacePath || process.cwd(),
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

      const evalData = this.extractJson(evalContent);

      const evaluation: Evaluation = {
        stepId: step.id,
        artifactId: `${step.id}_artifact`,
        passed: evalData.passed,
        score: evalData.score,
        feedback: evalData.feedback,
        suggestions: evalData.suggestions || [],
        evaluatedAt: new Date(),
      };

      return this.createResult(true, evaluation, undefined, startTime);
    } catch (error) {
      return this.createResult(
        false,
        undefined,
        `Evaluation failed: ${error}`,
        startTime
      );
    }
  }

  private extractJson(content: string): {
    passed: boolean;
    score: number;
    feedback: string;
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
      throw new Error('No JSON found in response');
    }
    return JSON.parse(jsonMatch[0]);
  }
}
