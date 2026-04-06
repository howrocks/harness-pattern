import { Orchestrator } from '../src/index.js';
import { ObservationEvent } from '../src/types.js';

/**
 * Example: Using the Harness to generate a simple web application
 */
async function main() {
  // Create orchestrator with configuration
  // Auth token is automatically detected from your local Claude Code installation
  // No manual configuration needed! (Override with authToken option if needed)
  const orchestrator = new Orchestrator({
    workspaceDir: './example-workspaces',
    config: {
      maxIterations: 10,
      autoRetryOnFailure: true,
      maxRetriesPerStep: 2,
      enableObservation: true,
    },
  });

  // Subscribe to observations for custom handling
  orchestrator.onObservation((event: ObservationEvent) => {
    // You could send this to a dashboard, save to database, etc.
    if (event.type === 'evaluation_completed') {
      console.log(`   Feedback: ${event.details?.feedback?.substring(0, 100)}...`);
    }
  });

  // Define the task
  const description = 'Build a website for introducing StarRocks';
  const requirements = [];

  console.log('═'.repeat(60));
  console.log('🤖 Harness System - Task Execution Demo');
  console.log('═'.repeat(60));
  console.log(`\nTask: ${description}\n`);
  console.log('Requirements:');
  requirements.forEach((r) => console.log(`  • ${r}`));
  console.log('\n');

  try {
    // Execute the task
    const result = await orchestrator.executeTask(description, requirements);

    console.log('\n' + '═'.repeat(60));
    console.log(`Result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log('═'.repeat(60));
    console.log(`Task ID: ${result.taskId}`);

    if (result.plan) {
      console.log(`\n📋 Plan: ${result.plan.steps.length} steps`);
      result.plan.steps.forEach((step, idx) => {
        const status = step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏳';
        console.log(`   ${status} ${idx + 1}. ${step.description}`);
      });
    }

    if (result.artifacts.length > 0) {
      console.log(`\n📝 Generated Artifacts: ${result.artifacts.length}`);
      result.artifacts.forEach((artifact, idx) => {
        const lines = artifact.content.split('\n').length;
        console.log(`   ${idx + 1}. ${artifact.stepId}: ${lines} lines`);
      });
    }

    if (result.evaluations.length > 0) {
      console.log(`\n📊 Step Evaluations:`);
      result.evaluations.forEach((eval_) => {
        const status = eval_.passed ? '✅' : '❌';
        console.log(`   ${status} ${eval_.stepId}: Score ${eval_.score}/100`);
      });
    }

    // Display final evaluation
    if (result.finalEvaluation) {
      console.log(`\n🎯 Final Evaluation:`);
      const fe = result.finalEvaluation;
      console.log(`   Status: ${fe.passed ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`   Score: ${fe.score}/100`);
      console.log(`   Feedback: ${fe.feedback.substring(0, 200)}${fe.feedback.length > 200 ? '...' : ''}`);

      if (fe.requirementsMet.length > 0) {
        console.log(`\n   Requirements Check:`);
        fe.requirementsMet.forEach((req) => {
          const status = req.met ? '✅' : '❌';
          console.log(`     ${status} ${req.requirement.substring(0, 50)}${req.requirement.length > 50 ? '...' : ''}`);
        });
      }

      if (fe.suggestions && fe.suggestions.length > 0) {
        console.log(`\n   Suggestions:`);
        fe.suggestions.forEach((suggestion, idx) => {
          console.log(`     ${idx + 1}. ${suggestion}`);
        });
      }
    }

    if (result.error) {
      console.log(`\n❌ Error: ${result.error}`);
    }

    console.log(`\n💾 Workspace saved in: ./example-workspaces/${result.taskId}`);
    console.log(`📄 Logs saved in: ./logs/`);

  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);
