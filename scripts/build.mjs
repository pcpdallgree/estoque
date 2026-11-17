import fs from 'node:fs/promises';
const config={
 url:process.env.VITE_SUPABASE_URL||'https://hwcxylgzhvjfagovucwq.supabase.co',
 key:process.env.VITE_SUPABASE_PUBLISHABLE_KEY||''
};
if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.url))throw Error('URL Supabase inválida.');
if(config.key&&!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.key))throw Error('Configure somente uma chave publicável.');
if(process.env.REQUIRE_PRODUCTION_CONFIG==='true'&&(config.url!=='https://hwcxylgzhvjfagovucwq.supabase.co'||!config.key||config.key.includes('CONFIGURE_AQUI')))
 throw Error('Projeto Supabase oficial e chave publicável são obrigatórios para Pages.');
await fs.mkdir('dist',{recursive:true});
await fs.cp('web','dist',{recursive:true});
await fs.writeFile('dist/config.js','export default '+JSON.stringify(config)+';\n');
await fs.writeFile('dist/.nojekyll','');
console.log('Aplicação estática gerada em dist.');
