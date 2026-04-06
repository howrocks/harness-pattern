import { mkdir, writeFile, readFile, readdir, stat, rmdir, access } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import type { Task, Plan, GeneratedArtifact, Evaluation } from '../types.js';

/**
 * Workspace provides isolated task execution environments
 * and filesystem-based context exchange between agents
 */
export class Workspace {
  public readonly taskId: string;
  public readonly basePath: string;

  constructor(taskId: string, basePath: string) {
    this.taskId = taskId;
    this.basePath = basePath;
  }

  /**
   * Create the workspace directory structure
   */
  async initialize(): Promise<void> {
    const dirs = [
      this.basePath,
      this.getPath('context'),
      this.getPath('artifacts'),
      this.getPath('logs'),
      this.getPath('evaluations'),
    ];

    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
    }

    // Create a metadata file
    await this.writeContext('metadata.json', {
      taskId: this.taskId,
      createdAt: new Date().toISOString(),
      status: 'initialized',
    });
  }

  /**
   * Get the full path for a relative workspace path
   */
  getPath(relativePath: string): string {
    return join(this.basePath, relativePath);
  }

  /**
   * Write context data as JSON for inter-agent communication
   */
  async writeContext(filename: string, data: unknown): Promise<void> {
    const path = this.getPath(join('context', filename));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Read context data from JSON
   */
  async readContext<T>(filename: string): Promise<T | null> {
    try {
      const path = this.getPath(join('context', filename));
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /**
   * Save the task definition
   */
  async saveTask(task: Task): Promise<void> {
    await this.writeContext('task.json', task);
  }

  /**
   * Load the task definition
   */
  async loadTask(): Promise<Task | null> {
    return this.readContext<Task>('task.json');
  }

  /**
   * Save the plan
   */
  async savePlan(plan: Plan): Promise<void> {
    await this.writeContext('plan.json', plan);
  }

  /**
   * Load the plan
   */
  async loadPlan(): Promise<Plan | null> {
    return this.readContext<Plan>('plan.json');
  }

  /**
   * Save a generated artifact
   */
  async saveArtifact(artifact: GeneratedArtifact): Promise<void> {
    const filename = `${artifact.stepId}_artifact.json`;
    await this.writeContext(join('artifacts', filename), artifact);
  }

  /**
   * Load an artifact by step ID
   */
  async loadArtifact(stepId: string): Promise<GeneratedArtifact | null> {
    return this.readContext<GeneratedArtifact>(join('artifacts', `${stepId}_artifact.json`));
  }

  /**
   * Save an evaluation
   */
  async saveEvaluation(evaluation: Evaluation): Promise<void> {
    const filename = `${evaluation.stepId}_evaluation.json`;
    await this.writeContext(join('evaluations', filename), evaluation);
  }

  /**
   * Load an evaluation by step ID
   */
  async loadEvaluation(stepId: string): Promise<Evaluation | null> {
    return this.readContext<Evaluation>(join('evaluations', `${stepId}_evaluation.json`));
  }

  /**
   * Get all artifacts
   */
  async listArtifacts(): Promise<GeneratedArtifact[]> {
    const artifactsPath = this.getPath('context/artifacts');
    if (!existsSync(artifactsPath)) return [];

    const files = await readdir(artifactsPath);
    const artifacts: GeneratedArtifact[] = [];

    for (const file of files) {
      if (file.endsWith('_artifact.json')) {
        const artifact = await this.readContext<GeneratedArtifact>(join('artifacts', file));
        if (artifact) artifacts.push(artifact);
      }
    }

    return artifacts;
  }

  /**
   * Get all evaluations
   */
  async listEvaluations(): Promise<Evaluation[]> {
    const evalPath = this.getPath('context/evaluations');
    if (!existsSync(evalPath)) return [];

    const files = await readdir(evalPath);
    const evaluations: Evaluation[] = [];

    for (const file of files) {
      if (file.endsWith('_evaluation.json')) {
        const evaluation = await this.readContext<Evaluation>(join('evaluations', file));
        if (evaluation) evaluations.push(evaluation);
      }
    }

    return evaluations;
  }

  /**
   * Update workspace status
   */
  async updateStatus(status: string): Promise<void> {
    const metadata = await this.readContext<{ taskId: string; createdAt: string; status: string }>('metadata.json');
    if (metadata) {
      metadata.status = status;
      await this.writeContext('metadata.json', metadata);
    }
  }

  /**
   * Check if workspace exists
   */
  async exists(): Promise<boolean> {
    try {
      await access(this.basePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up the workspace
   */
  async cleanup(): Promise<void> {
    if (await this.exists()) {
      await rmdir(this.basePath, { recursive: true });
    }
  }
}

/**
 * Factory for creating and managing workspaces
 */
export class WorkspaceFactory {
  private baseDir: string;

  constructor(baseDir: string = './workspaces') {
    this.baseDir = baseDir;
  }

  /**
   * Create a new workspace for a task
   */
  async createWorkspace(taskId: string): Promise<Workspace> {
    const workspacePath = join(this.baseDir, taskId);
    const workspace = new Workspace(taskId, workspacePath);
    await workspace.initialize();
    return workspace;
  }

  /**
   * Load an existing workspace
   */
  loadWorkspace(taskId: string): Workspace {
    const workspacePath = join(this.baseDir, taskId);
    return new Workspace(taskId, workspacePath);
  }

  /**
   * List all workspaces
   */
  async listWorkspaces(): Promise<string[]> {
    if (!existsSync(this.baseDir)) return [];

    const entries = await readdir(this.baseDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  /**
   * Check if a workspace exists
   */
  async workspaceExists(taskId: string): Promise<boolean> {
    const workspacePath = join(this.baseDir, taskId);
    try {
      const stats = await stat(workspacePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
}
