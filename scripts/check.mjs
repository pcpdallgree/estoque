import {stripTypeScriptTypes} from 'node:module';
import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for(const root of ['web','scripts','apps-script','supabase/functions']){
 for(const entry of await readdir(root,{recursive:true,withFileTypes:true})){
  if(!entry.isFile()||!/\.(js|mjs|ts|gs)$/.test(entry.name))continue;
  const file=entry.parentPath+'/'+entry.name;
  const extension=entry.name.split('.').at(-1);
  const stdin=['gs','ts'].includes(extension);
  const args=stdin?['--check','--input-type='+(extension==='gs'?'commonjs':'module')]:['--check',file];
  let input=stdin?(await import('node:fs')).readFileSync(file):undefined;
  if(extension==='ts')input=stripTypeScriptTypes(input.toString('utf8'));
  const result=spawnSync(process.execPath,args,{input,stdio:['pipe','inherit','inherit']});
  if(result.status!==0)process.exit(result.status||1);
 }
}
console.log('Sintaxe validada. A aplicação JavaScript não depende de compilação TypeScript.');
