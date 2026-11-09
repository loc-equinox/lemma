import { isDocumentJob, documentFile, type DocumentOutput } from '../shared/documents';
import type { Provider, GenerationContext } from './engine';
import type { Output } from '../shared/types';
export class DemoProvider implements Provider {
  async generate({ book, job, ids, parentId }: GenerationContext, signal: AbortSignal, progress: (s: string) => void, thread: (id: string) => void): Promise<Output | DocumentOutput> {
    thread(book.threadId || `demo-${book.id}`); progress('Preparing a deterministic demonstration…');
    await new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, 700); signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Interrupted')); }, { once: true }); });
    if (isDocumentJob(job)) return {
      jobId:job.id,file:documentFile(job.kind),title:job.sectionTitle || (job.kind==='progress'?'Study progress':'Convergence'),
      content:job.kind==='progress' ? '# Study progress\n\nThis is a deterministic demo. Prepared steps are not necessarily completed.\n\nNext: continue from the saved reading position.' : String.raw`A sequence converges to $L$ when every tolerance eventually contains its tail.

$$\forall \varepsilon>0\;\exists N\;\forall n\ge N: |a_n-L|<\varepsilon.$$

For $a_n=1/n$, choose $N>1/\varepsilon$. This is fixed demo reference content.`
    };
    const r = book.routes[job.routeId];
    const question = r.questionId ? book.questions[r.questionId] : null;
    const titles = question ? ['Why the definition matters', 'Connecting the idea back'] : ['A precise definition of convergence', 'Choosing the right threshold', 'Completing the argument', 'What the proof establishes'];
    const finished = question ? true : job.start + job.count >= 4;
    const content = question ? `A limit statement controls the **whole tail** of a sequence. The threshold may depend on $\\varepsilon$, but it cannot depend on the later choice of $n$.\n\nFor $a_n=1/n$, choose $N>1/\\varepsilon$. Every $n\\ge N$ then satisfies $|a_n|<\\varepsilon$.\n\nThis demonstration uses fixed content. Use live Codex mode for an answer to your particular question.` : [
      'A sequence $(a_n)$ converges to $L$ if every prescribed tolerance eventually contains the whole tail:\n\n$$\\forall \\varepsilon>0\\;\\exists N\\in\\mathbb N\\;\\forall n\\ge N:\\quad |a_n-L|<\\varepsilon.$$\n\nThe order of these quantifiers matters: we choose $N$ **after** the tolerance is given.',
      'For $a_n=1/n$ and $L=0$, the desired inequality is $1/n<\\varepsilon$. Solve it for $n$:\n\n$$n>\\frac{1}{\\varepsilon}.$$\n\nChoose $N=\\lfloor1/\\varepsilon\\rfloor+1$. This integer works for the prescribed tolerance.',
      'Let $\\varepsilon>0$ and choose $N=\\lfloor1/\\varepsilon\\rfloor+1$. If $n\\ge N$, then\n\n$$|1/n-0|=1/n\\le1/N<\\varepsilon.$$\n\nThis establishes the required tail bound for every positive tolerance.',
      'We have proved $1/n\\to0$ by producing a threshold for each tolerance. The statement concerns all sufficiently large indices; it does not require any term to equal the limit.\n\nThe requested demonstration is complete.'
    ][job.start];
    return { jobId: job.id, routeId: r.id, finished, continuation: finished ? r.returnTo : null, revisions: [], steps: ids.map((id,i) => ({ id, title: titles[job.start+i] || titles[0], content: question ? content : i ? 'Apply the definition by finding a threshold depending only on $\\varepsilon$.\n\n$$N=\\lfloor1/\\varepsilon\\rfloor+1.$$\n\nFor every $n\\ge N$, we have $1/n<\\varepsilon$.' : content, parentId: i ? ids[i-1] : parentId, nextId: ids[i+1] || null })) };
  }
}
