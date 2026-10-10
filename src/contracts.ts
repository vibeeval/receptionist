import { z } from 'zod';
import { AppError } from './security.js';
export const id=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const base={id,callId:id,occurredAt:z.iso.datetime({offset:true})};
export const eventSchema=z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('call.started'),data:z.object({callerPhone:z.string().regex(/^\+[1-9]\d{7,14}$/).optional()}).strict()}).strict(),
 z.object({...base,type:z.literal('intent.detected'),data:z.object({intent:z.enum(['booking','information','human','transfer','emergency','opt_out']),confidence:z.number().min(0).max(1)}).strict()}).strict(),
 z.object({...base,type:z.literal('call.ended'),data:z.object({}).strict()}).strict(),
 z.object({...base,type:z.literal('post_call'),data:z.object({}).strict()}).strict()
]);
export type Event=z.infer<typeof eventSchema>;
export const confirmationSchema=z.object({callId:id,slotId:id,attested:z.literal(true),evidenceId:id}).strict();
export const bookingSchema=z.object({commandId:id,callId:id,slotId:id,confirmationId:id}).strict();
export const controlSchema=z.object({kill:z.boolean(),operationId:id.optional(),expectedRevision:z.number().int().nonnegative().optional()}).strict();
export function parse<T>(schema:z.ZodType<T>,value:unknown):T {const r=schema.safeParse(value);if(!r.success)throw new AppError(400,'INVALID_PAYLOAD');return r.data;}
