import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const circl=process.env.CIRCL_DIR;
if(!circl) throw new Error('CIRCL_DIR required');
const tpl=await readFile(new URL('./circl-modern-acvp-template.go',import.meta.url),'utf8');
for(const p of ['44','65','87']){
  const content=tpl.replaceAll('__PARAMETER_SET__', 'ML-DSA-'+p);
  const dest=path.join(circl,'sign','mldsa','mldsa'+p,'internal','fae_modern_acvp_test.go');
  await writeFile(dest,content);
  console.log(dest);
}
