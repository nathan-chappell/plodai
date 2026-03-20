import type { CapabilityBundle, CapabilityDemoScenario } from "../types";

export const DEMO_VALIDATOR_CAPABILITY_ID = "demo-validator-agent";

const DEMO_VALIDATOR_INSTRUCTIONS = `
You are the hidden validator for a completed capability demo.

Review the thread that just finished and decide whether the demo satisfied its intended outcomes.
You have exactly one pricing tool available: \`get_current_thread_cost\`.
Call \`get_current_thread_cost\` exactly once before your final answer.

Reply briefly for the operator:
- state PASS or FAIL
- name the strongest reason
- include the total thread cost in USD

Do not ask follow-up questions or suggest next steps.
`.trim();

export function buildDemoValidatorCapabilityBundle(): CapabilityBundle {
  return {
    root_capability_id: DEMO_VALIDATOR_CAPABILITY_ID,
    capabilities: [
      {
        capability_id: DEMO_VALIDATOR_CAPABILITY_ID,
        agent_name: "Demo Validator",
        instructions: DEMO_VALIDATOR_INSTRUCTIONS,
        client_tools: [],
        handoff_targets: [],
      },
    ],
  };
}

export function buildDemoValidatorPrompt(scenario: CapabilityDemoScenario): string {
  const expectedOutcomes =
    scenario.expectedOutcomes?.length
      ? scenario.expectedOutcomes.join("; ")
      : "Confirm the demo completed the intended walkthrough.";

  return [
    `Validate the just-completed demo: ${scenario.title}.`,
    `Primary objective: ${scenario.summary}.`,
    `Expected outcomes: ${expectedOutcomes}.`,
    "Use the full thread context.",
    "Call get_current_thread_cost exactly once before answering.",
    "Reply briefly with PASS or FAIL, the strongest supporting reason, and the total cost in USD.",
  ].join(" ");
}
