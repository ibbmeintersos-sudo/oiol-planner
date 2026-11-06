import { scanRepository } from '../scanner/repository.mjs';
import { id } from '../core/utils.mjs';
export async function analyzeProject(input) {
  if (input.mode==='existing') {
    if (!input.repo) throw new Error('Existing-project mode requires --repo');
    const repo = await scanRepository(input.repo);
    return {kind:'existing',name:input.name||repo.root.split(/[\\/]/).pop(),request:input.request||'',repository:repo,
      evidence:[{id:id('ev'),type:'repository_scan',description:`Scanned ${repo.fileCount} repository files`,source:repo.root}],
      constraints:['Do not overwrite unrelated user changes','Do not assume undocumented behavior','Preserve existing project conventions']};
  }
  return {kind:'greenfield',name:input.name||'New Project',request:input.request||'',repository:null,
    evidence:[{id:id('ev'),type:'user_request',description:input.request||'No detailed request supplied',source:'user'}],
    constraints:['Prefer a minimal maintainable architecture','Define acceptance criteria before implementation','Keep secrets out of source control']};
}
