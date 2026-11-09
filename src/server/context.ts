import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { documentFile, isDocumentJob, type ReferenceNode } from '../shared/documents';
import { currentTree, nodeAt, type Book, type Step } from '../shared/types';
import type { GenerationContext } from './engine';

function describe(node: Step | ReferenceNode | undefined) {
  if (!node) return null;
  return 'kind' in node
    ? { id:node.id, kind:node.kind, title:node.title, file:node.file, version:node.version, supersededBy:node.supersededBy }
    : { id:node.id, title:node.title, routeId:node.routeId, index:node.index, version:node.version, completed:node.completed, supersededBy:node.supersededBy };
}
function reading(book: Book, tree = currentTree(book)) {
  return tree ? { treeId:tree.id, position:tree.cursor, cursorEpoch:tree.cursorEpoch, node:describe(nodeAt(book,tree.cursor)) } : null;
}

/** A turn-scoped lookup source. Only its address and local context enter the prompt. */
export function prepareContext(ctx: GenerationContext, root = tmpdir()) {
  const {book,job,ids,parentId} = ctx;
  mkdirSync(root,{recursive:true});
  const directory = mkdtempSync(join(resolve(root),'lemma-context-'));
  const path = join(directory,'context.json');
  const dispose = () => rmSync(directory,{recursive:true,force:true});
  try {
    const documents = Object.fromEntries((ctx.documents || []).map(d=>[d.file,d]));
    // Full precision stays local for old-node questions, compaction recovery and document jobs.
    // This file is never attached to a request or inserted into conversation history.
    writeFileSync(path,JSON.stringify({
      canvasEpoch:book.epoch, jobId:job.id, activeTreeId:book.activeTreeId,
      trees:book.trees, routes:book.routes, nodes:book.nodes, questions:book.questions,
      references:book.references, documents,
    }),{encoding:'utf8',mode:0o600,flag:'wx'});
    const common = {
      jobId:job.id, canvasEpoch:book.epoch,
      lookup: {
        file:path,
        format:'JSON dictionaries keyed by ID: trees, routes, nodes, questions, references; documents keyed by filename. Use python3 to select only needed entries/fields. Do not dump the entire file. This snapshot is valid only for this job.',
      },
      studyDocuments:(ctx.documents || []).map(d=>({file:d.file,path:join(book.directory,d.file),hash:d.hash,bytes:Buffer.byteLength(d.content)})),
      activeReading:reading(book),
    };
    if (isDocumentJob(job)) {
      const prompt = {
        ...common, task:job.request, file:documentFile(job.kind), sectionTitle:job.sectionTitle || null,
        instruction:job.kind === 'progress'
          ? 'Update the complete STUDY_PROGRESS.md. Read its existing content from the lookup JSON documents dictionary if present to preserve useful semantic history and user conventions. Query the snapshot for tree prompts, completed/current/prepared nodes and unresolved questions; read node bodies only if needed. Reference nodes are prepared material, not completed learning. State the next semantic study point without relying on canvas IDs. Return the document through the schema; the application saves it.'
          : 'Prepare a reference summary of the requested chapter: definitions, hypotheses, conclusions and key proof ideas, preserving textbook notation and numbering. Reuse conversation context; consult local materials or selected snapshot entries only as needed. Read existing chapter titles/sections from the lookup JSON documents[STUDY_NOTES.md] entry to avoid duplication and preserve conventions. Distinguish a preview from material already studied. Return only this chapter body, without repeating its title or adding application section markers. Use sectionTitle if supplied; otherwise reuse the existing title for this chapter. The application saves the section and creates a read-only reference.',
        available:{trees:Object.keys(book.trees).length,nodes:Object.keys(book.nodes).length,references:Object.keys(book.references).length},
      };
      return {prompt,dispose};
    }
    const route = book.routes[job.routeId], tree = book.trees[route.treeId];
    const question = route.questionId ? book.questions[route.questionId] : null;
    const source = question ? book.nodes[question.nodeId] || book.references[question.nodeId] : undefined;
    const currentIds = new Set(Object.values(book.trees).map(t=>nodeAt(book,t.cursor)?.id));
    const candidates = job.kind === 'question' ? Object.values(book.nodes).filter(n=>
      book.routes[n.routeId].treeId===route.treeId && !n.completed && !n.supersededBy && !currentIds.has(n.id)) : [];
    const prompt = {
      ...common, task:tree.prompt, routeId:route.id, startIndex:job.start,
      allocatedIds:ids, firstParentId:parentId, returnTo:route.returnTo,
      currentReadingPosition:tree.cursor,
      question,
      // Bound direct quotations; exact, untruncated content remains available on demand.
      questionSource:source ? {...describe(source)!,content:source.content.slice(0,6000),truncated:source.content.length>6000} : null,
      lastAcceptedSteps:route.nodeIds.slice(-2).map(id=>describe(book.nodes[id])),
      returnTarget:describe(nodeAt(book,route.returnTo)),
      revisionCandidates:{nodes:candidates.slice(0,8).map(describe),total:candidates.length},
      instruction:'Continue using this Codex conversation. Generate only allocated slots; do not repeat accepted steps. This request is a partial current-state update, not a replacement for conversation history. Reuse established material; look up exact content only when missing, changed, or needed for precision. Only committed nodes in the current lookup snapshot are valid; cancelled/rejected outputs are not accepted steps. Copy allocated IDs/relationships exactly. Last batch step nextId:null. continuation equals returnTo only if finished, otherwise null. Ordinary clarification creates steps; before proposing a revision read the exact eligible node/version from lookup. Return only the structured result.',
    };
    return {prompt,dispose};
  } catch (e) { dispose(); throw e; }
}
