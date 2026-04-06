import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import type { AgentType, AgentResult } from '../types.js';

export interface AgentConfig {
  authToken?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Automatically retrieve auth token from local Claude Code installation.
 * This allows seamless integration without manual configuration.
 */
function getClaudeCodeAuthToken(): string | undefined {
  try {
    const result = execSync('claude config get agent.authToken', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    const token = result.trim();
    if (token && token !== 'null' && token !== 'undefined') {
      return token;
    }
  } catch {
    // Claude Code not installed or config not available
  }
  return undefined;
}

/**
 * BaseAgent provides LLM capabilities using the Anthropic Agent SDK.
 *
 * Uses the Agent SDK's query() function which provides full Claude Code
 * capabilities including file system tools (Read, Edit, Bash, etc.).
 */
export abstract class BaseAgent {
  protected model: string;
  protected maxTokens: number;
  protected temperature: number;
  public readonly type: AgentType;

  constructor(type: AgentType, config: AgentConfig = {}) {
    this.type = type;

    const authToken =
      config.authToken ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      getClaudeCodeAuthToken();

    if (authToken) {
      process.env.ANTHROPIC_AUTH_TOKEN = authToken;
    }

    this.model = config.model || 'claude-opus-4-6-20251001';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0.2;
  }

  protected async callLLM(
    systemPrompt: string,
    userPrompt: string,
    cwd?: string
  ): Promise<{ content: string; usage?: { input_tokens: number; output_tokens: number } }> {
    // Use query() for full Claude Code capabilities with tools
    const q = query({
      prompt: `<system>\n${systemPrompt}\n</system>\n\n${userPrompt}`,
      options: {
        model: this.model,
        cwd: cwd || process.cwd(),
        // Allow file editing tools for generator
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
      },
    });

    let finalResult: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const message of q) {
      // Handle different message types from the query stream
      if (message.type === 'assistant') {
        // Extract text content from assistant message
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              finalResult = (finalResult || '') + block.text;
            }
          }
        }
      } else if (message.type === 'result' && message.subtype === 'success') {
        // Use the final result string if available
        if (message.result) {
          finalResult = message.result;
        }
        // Get usage stats
        inputTokens = message.usage.input_tokens || 0;
        outputTokens = message.usage.output_tokens || 0;
      }
    }

    if (!finalResult) {
      throw new Error('No response received from LLM');
    }

    return {
      content: finalResult,
      usage: inputTokens || outputTokens
        ? { input_tokens: inputTokens, output_tokens: outputTokens }
        : undefined,
    };
  }

  protected createResult<T>(
    success: boolean,
    data: T | undefined,
    error: string | undefined,
    startTime: number
  ): AgentResult<T> {
    return {
      success,
      data,
      error,
      metadata: {
        agentType: this.type,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      },
    };
  }
}
