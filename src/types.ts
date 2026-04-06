/**
 * Core types for the harness system
 */

export interface Task {
  id: string;
  description: string;
  requirements: string[];
  constraints?: string[];
  createdAt: Date;
}

export interface Plan {
  taskId: string;
  steps: PlanStep[];
  currentStepIndex: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface PlanStep {
  id: string;
  description: string;
  dependencies: string[];
  expectedOutput: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
}

export interface GeneratedArtifact {
  stepId: string;
  content: string;
  metadata: {
    generatedAt: Date;
    model: string;
    tokensUsed?: number;
  };
}

export interface Evaluation {
  stepId: string;
  artifactId: string;
  passed: boolean;
  score: number;
  feedback: string;
  suggestions?: string[];
  evaluatedAt: Date;
}

export interface FinalEvaluation {
  taskId: string;
  passed: boolean;
  score: number;
  feedback: string;
  requirementsMet: {
    requirement: string;
    met: boolean;
    evidence: string;
  }[];
  suggestions?: string[];
  evaluatedAt: Date;
}

export interface AgentContext {
  task: Task;
  plan?: Plan;
  currentStep?: PlanStep;
  artifacts: Map<string, GeneratedArtifact>;
  evaluations: Map<string, Evaluation>;
  workspacePath: string;
}

export interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata: {
    agentType: AgentType;
    duration: number;
    timestamp: Date;
  };
}

export type AgentType = 'planner' | 'generator' | 'evaluator';

export interface OrchestratorConfig {
  maxIterations: number;
  autoRetryOnFailure: boolean;
  maxRetriesPerStep: number;
  enableObservation: boolean;
}

export interface ObservationEvent {
  type: 'plan_created' | 'step_started' | 'step_completed' | 'step_failed' | 'evaluation_completed' | 'final_evaluation_completed' | 'task_completed' | 'error';
  taskId: string;
  stepId?: string;
  timestamp: Date;
  message: string;
  details?: Record<string, unknown>;
}

export type ObservationHandler = (event: ObservationEvent) => void;
