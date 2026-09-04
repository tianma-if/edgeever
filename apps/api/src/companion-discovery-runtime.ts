import { ToolLoopAgent, Output, type LanguageModel } from "ai";
import { CompanionDiscoveryOutputSchema } from "@edgeever/shared";
import { discoveryContext, type DiscoveryCandidate } from "./companion-discovery-context";

export type { DiscoveryCandidate } from "./companion-discovery-context";
export async function generateCompanionDiscovery(args: {
  model: LanguageModel; candidates: DiscoveryCandidate[]; anchorId: string; locale: string; signal: AbortSignal;
}) {
  const context = discoveryContext(args);
  const agent = new ToolLoopAgent({
    model: args.model, maxRetries: 0, maxOutputTokens: 1200,
    output: Output.object({ schema: CompanionDiscoveryOutputSchema }),
    instructions: context.instructions,
  });
  const result = await agent.generate({ prompt: context.prompt, abortSignal: args.signal });
  return context.decode(result.output);
}
