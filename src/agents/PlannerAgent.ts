import { BaseAgent } from './BaseAgent.js';
import type { Task, Plan, PlanStep, AgentResult, AgentConfig } from '../types.js';

export class PlannerAgent extends BaseAgent {
  constructor(config: AgentConfig = {}) {
    super('planner', config);
  }

  async createPlan(task: Task): Promise<AgentResult<Plan>> {
    const startTime = Date.now();

    try {
      const systemPrompt = `You are a planning agent. Your job is to break down complex tasks into clear, actionable steps.

Follow these principles:
1. Create 3-8 steps depending on task complexity
2. Each step should be atomic and verifiable
3. Steps should have clear dependencies on previous steps
4. Expected outputs should be specific and measurable

Respond ONLY with a JSON object in this format:
{
  "steps": [
    {
      "id": "step_1",
      "description": "Detailed description of what to do",
      "dependencies": [],
      "expectedOutput": "What should be produced"
    },
    {
      "id": "step_2",
      "description": "Next step",
      "dependencies": ["step_1"],
      "expectedOutput": "Expected result"
    }
  ]
}`;

      const userPrompt = `Create a detailed plan for this task:

Task ID: ${task.id}
Description: ${task.description}

Requirements:
${task.requirements.map((r) => `- ${r}`).join('\n')}

${task.constraints ? `Constraints:\n${task.constraints.map((c) => `- ${c}`).join('\n')}` : ''}

Break this down into executable steps. Each step should be clear enough for an implementation agent to execute.`;

      const response = await this.callLLM(systemPrompt, userPrompt);
      const planData = this.extractJson(response.content);

      const steps: PlanStep[] = planData.steps.map((step: { id: string; description: string; dependencies: string[]; expectedOutput: string }) => ({
        ...step,
        status: 'pending' as const,
      }));

      const plan: Plan = {
        taskId: task.id,
        steps,
        currentStepIndex: 0,
        status: 'pending',
      };

      return this.createResult(true, plan, undefined, startTime);
    } catch (error) {
      return this.createResult(false, undefined, `Planning failed: ${error}`, startTime);
    }
  }

  private extractJson(content: string): { steps: Array<{ id: string; description: string; dependencies: string[]; expectedOutput: string }> } {
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
