import { z } from 'zod/v4';
const ref = z.object({ routeId: z.string(), index: z.number().int().nonnegative() }).strict().nullable();
export const outputSchema = z.object({
  jobId: z.string(), routeId: z.string(),
  steps: z.array(z.object({ id: z.string(), title: z.string().min(1).max(300), content: z.string().min(1).max(40000), parentId: z.string().nullable(), nextId: z.string().nullable() }).strict()).min(1).max(2),
  finished: z.boolean(), continuation: ref,
  revisions: z.array(z.object({ nodeId: z.string(), expectedVersion: z.number().int().positive(), title: z.string().min(1).max(300), content: z.string().min(1).max(40000), reason: z.string().min(1) }).strict()).max(10),
}).strict();
export const jsonSchema = z.toJSONSchema(outputSchema);
export const teachingRules = `You teach rigorous mathematics one meaningful conceptual step per node. Read relevant local materials and their AGENTS.md teaching conventions, preserve textbook notation, definitions, numbering, and proof structure. Never modify material files. Do not use external services or web tools to share book contents. Use the user's language. Return only the requested structured result. The application's CURRENT snapshot is authoritative; old conversation nodes not present in the snapshot are invalid, especially after Clear. Generate only the allocated slots, never a whole chapter. A short route may finish with fewer slots. State when the requested learning task or explanation is finished. Ordinary questions create explanations; only actual errors or changed assumptions justify revisions to eligible unread future nodes. Use Markdown with $inline$ and $$display$$ LaTeX. Read-only local shell tools may inspect material. Never delegate or spawn agents. Each step should be readable on its own, with enough mathematical justification and a single conceptual purpose.`;
