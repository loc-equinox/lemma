import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { documentFile, documentFiles, type DocumentFile, type DocumentOutput, type DocumentSnapshot, type ReferenceNode } from '../shared/documents';
import type { Book, Job, Workspace } from '../shared/types';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const sectionId = (title: string) => digest(title.normalize('NFKC').trim().toLowerCase()).slice(0,24);
export function readDocument(directory: string, file: DocumentFile): DocumentSnapshot {
  if (!documentFiles.includes(file)) throw new Error('Only the two study documents can be accessed.');
  const path = join(directory,file);
  let stat;
  try { stat = lstatSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {file,content:'',hash:null}; throw e; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${file} must be a regular file, not a symlink.`);
  if (stat.size > 512 * 1024) throw new Error(`${file} exceeds the 512 KiB context limit. Split or shorten it before continuing.`);
  const content = readFileSync(path,'utf8');
  return { file, content, hash: digest(content) };
}
export const readDocuments = (directory: string) => documentFiles.map(file => readDocument(directory,file));
function replaceSection(document: string, key: string, title: string, content: string) {
  const start = `<!-- lemma:section:${key} -->`, end = `<!-- /lemma:section:${key} -->`;
  const section = `${start}\n## ${title.replace(/[\r\n]+/g,' ')}\n\n${content}\n${end}`;
  const from = document.indexOf(start), to = document.indexOf(end);
  if (from < 0 && to < 0) return document + (document ? '\n\n' : '# Study notes\n\n') + section + '\n';
  if (from < 0 || to < from || document.indexOf(start,from+start.length) >= 0) throw new Error('The chapter markers were edited externally. Restore them or choose a new section title.');
  return document.slice(0,from)+section+document.slice(to+end.length);
}
export function installReference(book: Book, reference: ReferenceNode) {
  book.references ??= {};
  for (const old of Object.values(book.references)) if (old.id !== reference.id && old.file === reference.file && old.sectionId === reference.sectionId && !old.supersededBy) old.supersededBy = reference.id;
  book.references[reference.id] = reference;
}
export function initDocumentStorage(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS document_writes (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, epoch INTEGER NOT NULL, file TEXT NOT NULL, before_body TEXT NOT NULL, after_body TEXT NOT NULL, reference TEXT NOT NULL, status TEXT NOT NULL)`);
}
export function recoverDocumentWrites(db: DatabaseSync, state: Workspace) {
  for (const row of db.prepare("SELECT * FROM document_writes WHERE status='pending'").all() as Record<string, any>[]) {
    const b = state.books[row.book_id];
    if (!b) continue;
    try {
      if (readDocument(b.directory,row.file).hash === digest(row.after_body)) {
        if (b.epoch === row.epoch) {
          installReference(b,JSON.parse(row.reference));
          if (b.jobs[row.id]) { b.jobs[row.id].status='completed'; b.jobs[row.id].error=undefined; }
        }
        db.prepare("UPDATE document_writes SET status='saved' WHERE id=?").run(row.id);
      } else db.prepare("UPDATE document_writes SET status='conflict' WHERE id=?").run(row.id);
    } catch { /* Leave the journal recoverable if a directory is temporarily unavailable. */ }
  }
}
export function saveDocument(db: DatabaseSync, book: Book, job: Job, output: DocumentOutput, snapshot: DocumentSnapshot): ReferenceNode {
  if ((job.kind !== 'notes' && job.kind !== 'progress') || output.jobId !== job.id || output.file !== documentFile(job.kind) || output.file !== snapshot.file) throw new Error('Document output does not match its task.');
  if (output.content.includes('<!-- lemma:') || output.content.includes('<!-- /lemma:')) throw new Error('Document content cannot contain application section markers.');
  if (readDocument(book.directory,output.file).hash !== snapshot.hash) throw new Error(`${output.file} changed while generating. Your external edits were preserved; retry to read the latest version.`);
  const title = job.sectionTitle || output.title;
  const key = job.kind === 'progress' ? 'progress' : sectionId(title);
  let content = output.content;
  const leadingHeading=/^#{1,6}[ \t]+([^\r\n]+)\r?\n+/.exec(content);
  if (job.kind==='notes' && leadingHeading && [title,output.title].some(t=>t.trim().toLowerCase()===leadingHeading[1].trim().toLowerCase())) content=content.slice(leadingHeading[0].length);
  if (!content.trim()) throw new Error('The chapter summary contains only a title. Retry for its content.');
  const after = job.kind === 'progress' ? content+'\n' : replaceSection(snapshot.content,key,title,content);
  if (Buffer.byteLength(after)>512*1024) throw new Error('The updated study document would exceed 512 KiB.');
  const old = Object.values(book.references).filter(r=>r.file===output.file&&r.sectionId===key).sort((a,b)=>b.version-a.version)[0];
  const reference: ReferenceNode = { kind:'reference',id:randomUUID(),file:output.file,sectionId:key,title,content,version:(old?.version||0)+1,supersededBy:null,createdAt:new Date().toISOString() };
  db.prepare('INSERT INTO document_writes VALUES (?,?,?,?,?,?,?,?)').run(job.id,book.id,book.epoch,output.file,snapshot.content,after,JSON.stringify(reference),'pending');
  const path = join(book.directory,output.file), temporary = join(book.directory,`.${output.file}.${randomUUID()}.tmp`);
  try {
    const fd = openSync(temporary,'wx',0o600);
    try { writeFileSync(fd,after,'utf8'); fsyncSync(fd); } finally {closeSync(fd);}
    if (readDocument(book.directory,output.file).hash !== snapshot.hash) throw new Error(`${output.file} changed before saving. Retry to preserve the latest edits.`);
    renameSync(temporary,path);
  } finally {if(existsSync(temporary))unlinkSync(temporary);}
  return reference;
}
export function importedReferences(book: Book, file: DocumentFile): ReferenceNode[] {
  const doc=readDocument(book.directory,file);
  if (!doc.content.trim()) throw new Error(`${file} does not exist or is empty.`);
  const sectionPattern=/<!-- lemma:section:([a-f0-9]+) -->\n## ([^\n]+)\n\n([\s\S]*?)\n<!-- \/lemma:section:\1 -->/g;
  const sections=[...doc.content.matchAll(sectionPattern)];
  const entries=file==='STUDY_NOTES.md' && sections.length ? sections.map(m=>({key:m[1],title:m[2],content:m[3]})) : [{key:file==='STUDY_PROGRESS.md'?'progress':'document',title:file==='STUDY_PROGRESS.md'?'Study progress':'Study notes',content:doc.content}];
  if (file==='STUDY_NOTES.md' && sections.length) {
    const existing=doc.content.replace(sectionPattern,'').trim();
    if (existing && existing!=='# Study notes') entries.unshift({key:'document',title:'Study notes — existing entries',content:existing});
  }
  return entries.map(entry=>{
    const old=Object.values(book.references).filter(r=>r.file===file&&r.sectionId===entry.key).sort((a,b)=>b.version-a.version)[0];
    if (old && old.content.trimEnd()===entry.content.trimEnd() && !old.supersededBy) return old;
    return {kind:'reference' as const,id:randomUUID(),file,sectionId:entry.key,title:entry.title,content:entry.content,version:(old?.version||0)+1,supersededBy:null,createdAt:new Date().toISOString()};
  });
}
