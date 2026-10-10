import { setup } from '../tests/autonomous/fixture.js';
import { egressEvidence } from '../tests/composition/no-egress.js';
const h=await setup();try{
 const p=await h.propose(),before=await h.commit(p);await h.window(p);await h.emit({id:'caller_digit',role:'dtmf',time_sec:7,digit:'1'});const reserved=await h.commit(p);await h.app.engine.drain();const result=await h.commit(p);
 if(before.body.booking_state!=='pending'||reserved.body.booking_state==='confirmed'||result.body.booking_state!=='confirmed'||h.stats().posts!==1)throw new Error('AUTONOMOUS_DEMO_FAILED');
 console.log(JSON.stringify({mode:'SYNTHETIC_LOOPBACK_ONLY',humanOperatorRequired:false,monitor:'injected independently authenticated-channel simulation',beforeDtmf:before.body.booking_state,beforeReceipt:reserved.body.booking_state,afterReceipt:result.body.booking_state,calendarPosts:h.stats().posts,externalRequests:egressEvidence.externalRequests,realCallVerified:false,cleanup:'temporary fixture removed in finally'},null,2));
}finally{await h.close();}
