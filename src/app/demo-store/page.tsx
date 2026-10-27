import {Suspense} from 'react';
import NikeStorefront from '@/components/partner/NikeStorefront';
import {RunProvider} from '@/components/normal/run-context';
export default function Page(){return <Suspense fallback={<p>Loading storefront…</p>}><RunProvider><NikeStorefront/></RunProvider></Suspense>;}
