const string = value => value == null ? '' : String(value);
const safe = value => typeof value==='string'&&/^[\s\uFEFF]*[=+\-@\t\r\n]/.test(value)?"'"+value:value;
const xml = value => string(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const encoder=new TextEncoder();
export function csv(columns,rows){
 return '\ufeff'+[columns.map(c=>c[1]),...rows.map(row=>columns.map(([key])=>safe(row[key])))]
  .map(row=>row.map(value=>'"'+string(value).replaceAll('"','""')+'"').join(';')).join('\r\n');
}
function crc32(bytes){
 let crc=-1;
 for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=crc>>>1^(0xedb88320&-(crc&1));}
 return (crc^-1)>>>0;
}
function zip(files){
 const parts=[],central=[];let position=0,centralSize=0;
 for(const [path,text] of Object.entries(files)){
  const name=encoder.encode(path),data=encoder.encode(text),hash=crc32(data);
  const local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
  lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);
  lv.setUint32(14,hash,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);local.set(name,30);
  const cd=new Uint8Array(46+name.length),v=new DataView(cd.buffer);
  v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint32(16,hash,true);
  v.setUint32(20,data.length,true);v.setUint32(24,data.length,true);v.setUint16(28,name.length,true);v.setUint32(42,position,true);cd.set(name,46);
  parts.push(local,data);central.push(cd);position+=local.length+data.length;centralSize+=cd.length;
 }
 const end=new Uint8Array(22),v=new DataView(end.buffer);
 v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);
 v.setUint32(12,centralSize,true);v.setUint32(16,position,true);
 return new Blob([...parts,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function xlsx(columns,rows){
 const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const packageRel='http://schemas.openxmlformats.org/package/2006/relationships';
 const data=[columns.map(c=>c[1]),...rows.map(r=>columns.map(([key])=>r[key]))];
 const sheet=data.map((r,i)=>'<row r="'+(i+1)+'">'+r.map(v=>typeof v==='number'&&Number.isFinite(v)?
  '<c><v>'+v+'</v></c>':'<c t="inlineStr"><is><t xml:space="preserve">'+xml(v)+'</t></is></c>').join('')+'</row>').join('');
 return zip({
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="'+packageRel+'"><Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':'<workbook xmlns="'+main+'" xmlns:r="'+rel+'"><sheets><sheet name="Estoque" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="'+packageRel+'"><Relationship Id="rId1" Type="'+rel+'/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':'<worksheet xmlns="'+main+'"><sheetData>'+sheet+'</sheetData></worksheet>'
 });
}
export function download(name,blob){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
export async function collect(fetchPage,first,limit=50000){
 if(!first||first.total>limit)throw Error('O relatório ultrapassa '+limit.toLocaleString('pt-BR')+' linhas. Reduza o período ou aplique filtros.');
 const rows=[];
 while(rows.length<first.total){
  const page=await fetchPage(rows.length);
  if(page.version!==first.version||page.total!==first.total||!page.rows.length)throw Error('A base foi atualizada. Atualize a consulta e repita a exportação.');
  rows.push(...page.rows);
 }
 if(rows.length!==first.total)throw Error('Quantidade exportada diverge da consulta.');
 return rows;
}
