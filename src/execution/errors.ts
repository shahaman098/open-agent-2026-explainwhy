export class ExecutionError extends Error {
 readonly name = 'EvidenceError';
 constructor(message:string, readonly code = 'execution_blocked', readonly status = 409) { super(message); }
}
