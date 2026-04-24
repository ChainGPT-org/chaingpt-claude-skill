import { SmartContractAuditor } from '@chaingpt/smartcontractauditor';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const auditor = new SmartContractAuditor({
  apiKey: process.env.CHAINGPT_API_KEY!,
});

export const auditTools: Tool[] = [
  {
    name: 'chaingpt_audit_contract',
    description:
      'Audit a Solidity smart contract for security vulnerabilities, gas inefficiencies, access control issues, reentrancy, integer overflow, and more. Returns a scored audit report (0-100%) with categorized findings by severity (Critical/High/Medium/Low/Informational) and remediation suggestions. Costs 1 credit (2 with chat history). Supports follow-up questions about the same audit via sessionId.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceCode: {
          type: 'string',
          description:
            'The Solidity smart contract source code to audit. Include pragma and all imports.',
        },
        auditInstructions: {
          type: 'string',
          description:
            'Optional specific audit instructions (e.g. "focus on reentrancy and access control")',
        },
        followUpQuestion: {
          type: 'string',
          description:
            'A follow-up question about a previous audit (requires sessionId). When provided, sourceCode is not needed.',
        },
        sessionId: {
          type: 'string',
          description:
            'Session ID for multi-turn audit conversations. Required for follow-up questions.',
        },
      },
      required: [],
    },
  },
];

export async function handleAuditTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'Error: No arguments provided' }] };
  }

  try {
    if (name === 'chaingpt_audit_contract') {
      const isFollowUp = !!args.followUpQuestion;

      if (!isFollowUp && !args.sourceCode) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Either sourceCode (for new audits) or followUpQuestion + sessionId (for follow-ups) is required.',
            },
          ],
        };
      }

      let question: string;
      if (isFollowUp) {
        question = args.followUpQuestion as string;
      } else {
        const instructions = args.auditInstructions
          ? `${args.auditInstructions}:\n\n`
          : 'Perform a comprehensive security audit of this smart contract:\n\n';
        question = `${instructions}${args.sourceCode}`;
      }

      const useChatHistory = isFollowUp || !!args.sessionId;

      const response = await auditor.auditSmartContractBlob({
        question,
        chatHistory: useChatHistory ? 'on' : 'off',
        ...(args.sessionId ? { sdkUniqueId: args.sessionId as string } : {}),
      });

      const botResponse = (response as any)?.data?.bot ?? JSON.stringify(response);
      return { content: [{ type: 'text', text: botResponse }] };
    }

    return { content: [{ type: 'text', text: `Unknown audit tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Audit error: ${message}`);
  }
}
