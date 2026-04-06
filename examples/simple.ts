import { Orchestrator } from '../src/index.js';

/**
 * Minimal example: Simple code generation task
 */
async function main() {
  const orchestrator = new Orchestrator({
    workspaceDir: './workspaces',
  });

  const result = await orchestrator.executeTask(
    'Create a Python function to calculate Fibonacci numbers',
    [
      'Implement an efficient algorithm (O(n) time or better)',
      'Include input validation',
      'Add docstrings and type hints',
      'Write example usage code',
    ]
  );

  console.log(result.success ? '✅ Task completed!' : '❌ Task failed');
  if (result.artifacts.length > 0) {
    console.log('\nGenerated code:');
    console.log(result.artifacts[0].content);
  }
}

main().catch(console.error);
