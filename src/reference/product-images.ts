import manifest from './product-images.json';
interface Image {src:string;alt:string;sourceUrl?:string}
interface Entry {styleCode:string;images:Image[]}
/** Join by stable reference ID and verified style. Never create a business product. */
export function productImages(referenceProductId:string,styleCode?:string,imageUrl?:string):Image[]{
 const item=(manifest as Record<string,Entry>)[referenceProductId];
 if(item&&item.styleCode===styleCode)return item.images;
 if(imageUrl?.startsWith('https://static.nike.com/'))return [{src:imageUrl,alt:'Recorded product image'}];
 return [];
}
