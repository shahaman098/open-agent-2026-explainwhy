import 'server-only';
import { guardDevRoute } from '@/lib/route-helpers';
import { apiError } from '@/lib/api';
import { ExecutionScope } from './service';
export function executionGuard(request:Request) {
 const denied=guardDevRoute(request); if(denied) return denied;
 const origin=request.headers.get('origin');
 if (request.method!=='GET' && origin && origin!==new URL(request.url).origin) return apiError('invalid_origin','Use the same-origin approval workflow.',403);
 return null;
}
// No browser-supplied user ID is accepted. Production remains gated by the
// existing configured demo key until the host supplies authenticated identity.
export const demoPrincipal = () => process.env.NODE_ENV === 'development' ? 'local_demo_human' : 'configured_demo_operator';
export function executionScope(request:Request, planId:string) {
 return {...ExecutionScope.parse(Object.fromEntries(new URL(request.url).searchParams)),planId};
}
