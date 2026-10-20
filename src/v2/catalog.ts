import { tools, toolCategories } from '../tools/registry';
import type { WorkerOperation } from '../pdf/types';

export type V2Tool = {
  id: string; name: string; category: string; description: string; icon: string;
  multiple: boolean; accepts: string; operation: WorkerOperation | null;
  readiness: 'active' | 'rebuilding'; featured: boolean;
};
const nativeOperations: Partial<Record<string, WorkerOperation>> = {
  merge: 'merge', split: 'split', organize: 'organize', compress: 'optimize', 'edit-pdf': 'direct-edit', 'remove-pages': 'remove-pages',
  'extract-pages':'extract-pages', rotate:'rotate', 'page-numbers':'page-numbers',
  watermark:'watermark', crop:'crop', 'metadata-edit':'metadata-edit',
  annotate:'annotate', metadata:'metadata', 'images-to-pdf':'images-to-pdf',
  forms:'forms-fill'
};
const symbols: Record<string,string> = {
  merge:'⇄', split:'⌁', 'remove-pages':'−', 'extract-pages':'▤',
  organize:'▦', rotate:'↻', compress:'⇩', 'edit-pdf':'✎',
  'page-numbers':'№',watermark:'◇',crop:'⌗',annotate:'✎',
  'images-to-pdf':'▧', 'pdf-to-images':'▣', forms:'☑',ocr:'◈',
  metadata:'ⓘ','metadata-edit':'⌘',compare:'◫'
};
const preferred: Record<string,string> = {
  merge:'Merge PDFs',split:'Split PDF', 'remove-pages':'Remove pages',
  'extract-pages':'Extract pages',rotate:'Rotate PDF',
  'page-numbers':'Page numbers',watermark:'Watermark',compress:'Optimize PDF',
  'images-to-pdf':'Images to PDF',forms:'Fill PDF forms'
};
export const groups = [
  {id:'all',label:'All tools'}, ...toolCategories.map(c=>({id:c.id,label:c.label}))
];
export const v2Tools: V2Tool[] = tools.map(t=>({
  id:t.id, name:preferred[t.id] ?? t.name, category:t.category,
  description:t.description, icon:symbols[t.id]??t.icon,
  multiple:t.multipleFiles, accepts:t.id==='images-to-pdf'?'.png,.jpg,.jpeg,image/png,image/jpeg':'.pdf,application/pdf',
  operation:nativeOperations[t.id]??null,
  readiness:nativeOperations[t.id]?'active':'rebuilding',
  featured:['merge','split','compress','edit-pdf','organize','rotate'].includes(t.id)
}));
export const activeTools=v2Tools.filter(t=>t.readiness==='active');
export const getTool=(id:string): V2Tool|undefined=>v2Tools.find(t=>t.id===id);
export const categoryLabel=(id:string):string=>groups.find(g=>g.id===id)?.label??'Tools';
