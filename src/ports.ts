/** Live adapters must be implemented and accepted separately. Requests cannot select adapters. */
export type Receipt={id:string;providerMock:boolean};
export type LookupResult={status:'confirmed';receipt:Receipt}|{status:'absent'|'unknown'};
export interface CalendarPort {
 readonly providerMock:boolean;
 /** tenant + command is a stable idempotency key, never a caller-supplied provider URL. */
 book(tenant:string,command:string,slot:string):Promise<Receipt>;
 /** absent means authoritative no-side-effect. Eventually consistent absence MUST be unknown. */
 lookup(tenant:string,command:string):Promise<LookupResult>;
}
export interface CrmPort {readonly providerMock:boolean;readonly deliveryKind?:'local'|'webhook';upsertCrm(tenant:string,command:string,receipt:string):Promise<void>;}
