import { isStepCount, tool, ToolLoopAgent, type LanguageModel } from "ai";
import { z } from "zod";
import { infographicRequestsTimeline, type InfographicAgentEvent, type InfographicAgentRequest } from "@edgeever/shared";
import { throwIfAborted } from "./abort-signal";

export const runInfographicAgent = async (args: {
  input: InfographicAgentRequest;
  model: LanguageModel;
  signal: AbortSignal;
  onEvent: (event: InfographicAgentEvent) => void;
}) => {
  const { input, onEvent } = args;
  let proposed = false;
  let asked = false;
  let fallbackResponse = "";
  let response = "";
  const candidates = new Set(input.candidates);
  const timelineRequested = infographicRequestsTimeline(input.prompt);
  const agent = new ToolLoopAgent({
    model: args.model,
    instructions: `You edit one AntV infographic through a conversation. The current infographic content is the source of truth; previous assistant replies may describe changes that were not applied. Understand the user's meaning and previous turns. Keep the current template for content-only changes, including replacing one comparison subject. Change the template when the data relationship changes, even if the user does not name a diagram type. A request for one company's development history needs chronological events in a sequence-timeline template, not the old two-company comparison. Choose only from the allowed template IDs. Prefer a comparison template with a VS divider for two subjects and matched aspects. Preserve information the user did not ask to change. data.title is the note title: change it when the subject changes, and keep it when the user only edits details. Ask a short clarification only if you cannot make a useful edit. Call one accepted tool before your final concise response, in the user's language. Do not output JSON in your final response.\nCurrent template: ${input.currentTemplate ?? "none"}.\nCurrent infographic content: ${input.currentContent || "none"}.\nAllowed templates: ${input.candidates.join(", ")}.\nData shapes: chart={title,values:[{label,value:number}]}; comparison={title,compares:[{label,children:[{label,desc}]}]}; quadrant={title,compares:[four items]}; hierarchy={title,root:{label,children:[...]}}; relation={title,nodes:[{id,label}],relations:[{from,to}]}; sequence={title,sequences:[{label,desc}]}; list={title,lists:[{label,desc}]}. Binary comparisons need exactly two compares with matching children. Use concise labels and complete content.`,
    tools: {
      propose_infographic: tool({
        description: "Propose a complete, editable infographic version. Choose an allowed template and its matching data shape.",
        inputSchema: z.object({
          template: z.string(),
          data: z.record(z.string(), z.unknown()),
          explanation: z.string().max(500),
        }),
        execute: async ({ template, data, explanation }) => {
          if (proposed || asked || !candidates.has(template)) return { accepted: false, reason: "Choose one allowed template and call one tool only." };
          if (timelineRequested && !template.startsWith("sequence-timeline-")) return { accepted: false, reason: "The user requested one subject's development history. Choose an allowed sequence-timeline template and chronological events." };
          proposed = true;
          fallbackResponse = explanation;
          onEvent({ type: "proposal", template, data, explanation });
          return { accepted: true, template, instruction: "Briefly tell the user what changed." };
        },
      }),
      ask_clarification: tool({
        description: "Ask a focused question when the infographic cannot be edited correctly without the user's answer.",
        inputSchema: z.object({ question: z.string().trim().min(1).max(300) }),
        execute: async ({ question }) => {
          if (proposed || asked) return { accepted: false, reason: "Call one tool only." };
          if (timelineRequested && input.candidates.some((template) => template.startsWith("sequence-timeline-"))) return { accepted: false, reason: "The timeline request is clear. Propose a chronological infographic instead of asking for clarification." };
          asked = true;
          fallbackResponse = question;
          onEvent({ type: "question", question });
          return { accepted: true, instruction: "Repeat the question briefly to the user." };
        },
      }),
    },
    prepareStep: () => !proposed && !asked
      ? { toolChoice: "required" as const }
      : { activeTools: [] as [], toolChoice: "none" as const },
    stopWhen: isStepCount(4),
    maxOutputTokens: 3000,
    maxRetries: 0,
  });
  const messages = [
    ...input.history.flatMap((turn) => [
      { role: "user" as const, content: turn.prompt },
      { role: "assistant" as const, content: turn.response },
    ]),
    { role: "user" as const, content: input.prompt },
  ];
  const result = await agent.stream({ messages, abortSignal: args.signal });
  for await (const part of result.fullStream) {
    throwIfAborted(args.signal);
    if (part.type === "error") throw part.error;
    if (part.type !== "text-delta" || !part.text || !proposed || asked) continue;
    response += part.text;
    if (response.length > 4000) throw new Error("The infographic agent response was too long.");
    onEvent({ type: "text-delta", text: part.text });
  }
  if (!proposed && !asked) throw new Error("The infographic agent did not propose a change or question.");
  if ((asked || !response.trim()) && fallbackResponse) onEvent({ type: "text-delta", text: fallbackResponse });
  onEvent({ type: "finish" });
};
