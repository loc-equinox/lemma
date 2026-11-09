export type DocumentFile = 'STUDY_PROGRESS.md' | 'STUDY_NOTES.md';
export type DocumentKind = 'progress' | 'notes';
export type DocumentSnapshot = { file: DocumentFile; content: string; hash: string | null };
export type DocumentOutput = { jobId: string; file: DocumentFile; title: string; content: string };
export type ReferenceNode = { kind: 'reference'; id: string; file: DocumentFile; sectionId: string; title: string; content: string; version: number; supersededBy: string | null; createdAt: string };
export const documentFiles: DocumentFile[] = ['STUDY_PROGRESS.md', 'STUDY_NOTES.md'];
export const documentFile = (kind: DocumentKind): DocumentFile => kind === 'progress' ? 'STUDY_PROGRESS.md' : 'STUDY_NOTES.md';
export const isDocumentJob = (job: { kind: string }): job is { kind: DocumentKind } => job.kind === 'notes' || job.kind === 'progress';
export function instructionKind(text: string): DocumentKind | null {
  text=text.trim();
  const writeIntent=/^(?:(?:请|请帮我|帮我)\s*)?(?:更新|保存|记录|整理|总结|创建|补充|写入)/.test(text) || /^(?:please\s+)?(?:update|save|write|summari[sz]e|create)\b/i.test(text);
  if (/^\/progress\b/i.test(text) || (/STUDY_PROGRESS\.md/i.test(text) && writeIntent) || /^(请|帮我)?\s*(更新|保存|记录|整理)(一下)?(学习)?进度/.test(text)) return 'progress';
  if (/^\/notes\b/i.test(text) || (/STUDY_NOTES\.md/i.test(text) && writeIntent) || /^(请|帮我)?\s*(更新|保存|整理|总结)(一下)?(章节|学习)?笔记/.test(text)) return 'notes';
  if (/^(请|帮我)?\s*(整理|总结|归纳).{0,40}(章|节).{0,20}(结论|要点|重点|笔记)/.test(text)) return 'notes';
  return null;
}
