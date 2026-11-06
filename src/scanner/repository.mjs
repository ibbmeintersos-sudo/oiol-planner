import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { redact } from '../core/utils.mjs';
const exec = promisify(execFile);
const IGNORE = new Set(['node_modules','.git','.next','dist','build','coverage','.venv','venv','vendor','target','.cache']);
const SENSITIVE = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.key|credentials\.json)$/i;
const MANIFESTS = ['package.json','pyproject.toml','requirements.txt','Cargo.toml','go.mod','pom.xml','build.gradle','composer.json'];
async function walk(root, rel='', out=[]) {
  const dir = path.join(root, rel);
  let entries; try { entries = await fs.readdir(dir,{withFileTypes:true}); } catch { return out; }
  for (const e of entries) {
    const r = path.posix.join(rel.replaceAll('\\','/'),e.name);
    if (IGNORE.has(e.name) || SENSITIVE.test(r) || e.isSymbolicLink()) continue;
    if (e.isDirectory()) await walk(root,r,out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}
export async function scanRepository(repoPath, {maxFiles=250,maxFileBytes=16000,maxContextChars=50000}={}) {
  const root = path.resolve(repoPath);
  const st = await fs.stat(root); if (!st.isDirectory()) throw new Error('Repository path is not a directory');
  let git = {isRepo:false,branch:null,commit:null,dirty:null};
  try {
    const [branch,commit,status] = await Promise.all([
      exec('git',['branch','--show-current'],{cwd:root}), exec('git',['rev-parse','HEAD'],{cwd:root}), exec('git',['status','--porcelain=v1','-z'],{cwd:root})
    ]);
    git={isRepo:true,branch:branch.stdout.trim(),commit:commit.stdout.trim(),dirty:status.stdout.length>0};
  } catch {}
  const all = await walk(root); const files = all.slice(0,maxFiles);
  const manifests = files.filter(f=>MANIFESTS.includes(path.posix.basename(f)));
  const scripts=[]; const tests=[]; const configs=[];
  for (const f of files) {
    if (/test|spec|__tests__/i.test(f)) tests.push(f);
    if (/config|\.config\./i.test(f)) configs.push(f);
    if (path.posix.basename(f)==='package.json') {
      try { const j=JSON.parse(await fs.readFile(path.join(root,f),'utf8')); scripts.push(...Object.keys(j.scripts||{}).map(k=>`npm run ${k}`)); } catch {}
    }
  }
  const selected = [...new Set([...manifests,...tests.slice(0,20),...configs.slice(0,20),...files.filter(f=>/\.(mjs|cjs|js|ts|tsx|py|go|rs|java|md)$/i.test(f)).slice(0,50)])];
  let context=''; const snippets=[];
  for (const f of selected) {
    try { const b=await fs.readFile(path.join(root,f)); if (b.length>maxFileBytes || b.includes(0)) continue;
      const text=redact(b.toString('utf8')).slice(0,5000); if(context.length+text.length>maxContextChars) break;
      context+=`\n\n--- ${f} ---\n${text}`; snippets.push({path:f,content:text});
    } catch {}
  }
  return {kind:'existing',root,git,files:files.map(p=>({path:p})),fileCount:all.length,truncated:all.length>files.length,manifests,scripts:uniq(scripts),tests,configs,context,snippets};
}
function uniq(a){return [...new Set(a)];}
