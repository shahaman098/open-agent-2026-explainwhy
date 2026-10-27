'use client';
import {useState,type ImgHTMLAttributes} from 'react';
export function ProductImage({src,alt,...props}:ImgHTMLAttributes<HTMLImageElement>){
 const [failed,setFailed]=useState<string>();
 // Static local assets or allowlisted public Nike URLs only; no image proxy.
 const safe=typeof src==='string'&&(src.startsWith('/assets/')||src.startsWith('https://static.nike.com/'));
 // eslint-disable-next-line @next/next/no-img-element
 return <img {...props} src={safe&&failed!==src?src:'/assets/product-unavailable.svg'} alt={alt??'Product image'} onError={()=>setFailed(String(src))}/>;
}
