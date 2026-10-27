import sharp from 'sharp';
/** Public, identity-matched asset cache. No runtime proxy or business-data writes. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {NIKE_REFERENCE_CATALOGUE} from '../src/reference/nike-catalogue';
async function main(){
 const manifest:Record<string,unknown>={};mkdirSync('public/assets/products',{recursive:true});
 await Promise.all(NIKE_REFERENCE_CATALOGUE.map(async(p)=>{
  const cache=`/private/tmp/normal-nike-pages/${p.referenceProductId}.html`;
  const html=existsSync(cache)?readFileSync(cache,'utf8'):await (await fetch(p.sourceUrl)).text();
  const match=html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const selected=match?JSON.parse(match[1]).props?.pageProps?.selectedProduct:null;
  const urls:string[]=[]; if(p.imageUrl)urls.push(p.imageUrl);
  if(selected?.styleColor===p.styleCode){for(const card of selected.contentImages??[])if(card.cardType==='image'){const url=card.properties?.squarish?.url??card.properties?.portrait?.url;if(url)urls.push(url);}}
  const images=[];
  for(const [i,sourceUrl] of [...new Set(urls)].entries()){
   if(new URL(sourceUrl).hostname!=='static.nike.com')continue;
   const fetchUrl=sourceUrl.replace('/t_default/','/w_640,c_limit/');
   try{const r=await fetch(fetchUrl,{signal:AbortSignal.timeout(20000)});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))continue;
   const path=`/assets/products/${p.referenceProductId}-${i}.webp`;
   writeFileSync(`public${path}`,await sharp(Buffer.from(await r.arrayBuffer())).resize({width:640,height:640,fit:"inside",withoutEnlargement:true}).webp({quality:84}).toBuffer());images.push({src:path,sourceUrl,alt:`${p.name} — view ${images.length+1}`});
   }catch{/* Keep graceful unavailable coverage in the manifest. */}
  }
  manifest[p.referenceProductId]={styleCode:p.styleCode,sourceUrl:p.sourceUrl,verifiedAt:'2026-10-25',images};console.log(p.referenceProductId,images.length);
 }));
 writeFileSync('src/reference/product-images.json',JSON.stringify(manifest,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
