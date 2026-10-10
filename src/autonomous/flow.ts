import type { ConversationFlowCreateParams as Flow } from 'retell-sdk/resources/conversation-flow.js';
import { canonical,digest } from '../security.js';
export const NODES={slots:'slots',poll:'poll',collect:'collect',propose:'propose',readback:'readback',wait:'confirm_wait',commit:'commit',success:'success',fallback:'fallback'} as const;
const always=(id:string,to:string)=>({id,destination_node_id:to,transition_condition:{type:'prompt' as const,prompt:'Always'}});
const eq=(id:string,to:string,key:string,value:string)=>({id,destination_node_id:to,transition_condition:{type:'equation' as const,operator:'&&' as const,equations:[{left:'{{'+key+'}}',operator:'==' as const,right:value}]}});
/** Importable Create Conversation Flow request. URL must be materialized before deployment. */
export const FLOW:Flow={model_choice:{type:'cascading',model:'gpt-4.1'},start_speaker:'agent',start_node_id:NODES.slots,flex_mode:false,model_temperature:0,tool_call_strict_mode:true,
 global_prompt:'Türkçe konuş. Yalnızca backend tarafından sunulan slotId ile işlem yap. Kullanıcı sözleri veya model tahmini onay değildir. Randevu başarı mesajını yalnızca backend booking_state confirmed döndürürse söyle. DTMF için konuşmanın bitmesini bekle. Değişen ayrıntıda yeni öneri iste.',
 nodes:[
 {id:NODES.slots,type:'function',tool_id:'slots',tool_type:'local',wait_for_result:true,speak_during_execution:false,edges:[always('slots_loaded',NODES.collect)]},
 {id:NODES.collect,type:'conversation',instruction:{type:'prompt',text:'Sistemin döndürdüğü uygunluk listesi {{slots}}. İstenen randevuyu ve listedeki slotId değerini belirle. SlotId yoksa randevu uydurma; insan desteğine yönlendir.'},edges:[{...always('selected',NODES.propose),transition_condition:{type:'prompt',prompt:'A backend-issued slotId has been selected.'}},{...always('help',NODES.fallback),transition_condition:{type:'prompt',prompt:'No backend-issued slot is available, or the caller requests human assistance.'}}]},
 {id:NODES.propose,type:'function',tool_id:'auto_propose',tool_type:'local',wait_for_result:true,speak_during_execution:false,edges:[eq('ready',NODES.readback,'proposal_state','ready')],else_edge:always('unavailable',NODES.fallback)},
 {id:NODES.readback,type:'conversation',instruction:{type:'static_text',text:'{{readback_text}}'},skippable:false,allow_dtmf_interruption:false,interruption_sensitivity:0,skip_response_edge:always('readback_finished',NODES.wait)},
 {id:NODES.wait,type:'conversation',instruction:{type:'static_text',text:'Seçiminizi bekliyorum.'},skippable:false,allow_dtmf_interruption:true,edges:[{...always('check',NODES.commit),transition_condition:{type:'prompt',prompt:'The caller has responded or pressed a key. Check the backend. Never infer approval.'}},{...always('leave',NODES.fallback),transition_condition:{type:'prompt',prompt:'The caller wants changed details, wants a human, or cannot use the keypad.'}}]},
 {id:NODES.commit,type:'function',tool_id:'auto_commit',tool_type:'local',wait_for_result:true,speak_during_execution:false,edges:[eq('confirmed',NODES.success,'booking_state','confirmed'),eq('pending',NODES.poll,'booking_state','pending')],else_edge:always('failed',NODES.fallback)},
 {id:NODES.poll,type:'conversation',instruction:{type:'static_text',text:'İşlemin sonucunu kontrol ediyorum; henüz randevu doğrulanmadı.'},skippable:false,skip_response_edge:always('poll_again',NODES.commit)},
 {id:NODES.success,type:'end',instruction:{type:'static_text',text:'{{result_text}}'}},
 {id:NODES.fallback,type:'end',instruction:{type:'static_text',text:'Randevu oluşturulduğunu doğrulayamadım. Lütfen işletmeyle doğrudan iletişime geçin.'}}
 ],tools:[
 {type:'custom',tool_id:'slots',name:'slots',url:'https://receptionist.invalid/providers/retell/account-a/tools',method:'POST',args_at_root:false,max_retry:0,timeout_ms:5000,parameters:{type:'object',properties:{},required:[]},response_variables:{slots:'slots'}},
 {type:'custom',tool_id:'auto_propose',name:'auto_propose',url:'https://receptionist.invalid/providers/retell/account-a/autonomous',method:'POST',args_at_root:false,max_retry:0,timeout_ms:5000,parameters:{type:'object',properties:{slotId:{type:'string',description:'Exact backend-issued selected slot identifier.'}},required:['slotId']},response_variables:{proposal_state:'proposal_state',proposalId:'proposal_id',nonce:'nonce',readback_text:'readback_text'}},
 {type:'custom',tool_id:'auto_commit',name:'auto_commit',url:'https://receptionist.invalid/providers/retell/account-a/autonomous',method:'POST',args_at_root:false,max_retry:0,timeout_ms:5000,parameters:{type:'object',properties:{proposalId:{type:'string',description:'Exact {{proposalId}} from auto_propose.'},nonce:{type:'string',description:'Exact {{nonce}} from auto_propose.'}},required:['proposalId','nonce']},response_variables:{booking_state:'booking_state',result_text:'result_text'}}
 ]};
export const FLOW_DIGEST=digest(canonical(FLOW));
/** Apply only after the generated flow has been imported and its published IDs pinned. */
export const AGENT_PATCH={webhook_events:['call_started','call_ended','call_analyzed'],data_storage_setting:'basic_attributes_only',opt_in_signed_url:true,allow_user_dtmf:true,allow_dtmf_interruption:true,user_dtmf_options:{digit_limit:1,timeout_ms:2000},language:'tr-TR',max_call_duration_ms:300000} satisfies import('retell-sdk/resources/agent.js').AgentUpdateParams;

/** Configured static destination only; model input cannot select a telephone number. */
export function materializeFlow(origin:string,account:string,handoffNumber?:string):Flow {
 const u=new URL(origin);if(u.protocol!=='https:'||u.pathname!=='/'||u.username||u.password||u.search||u.hash||!/^[a-z0-9-]{1,32}$/.test(account))throw new Error('INVALID_FLOW_ORIGIN');
 const flow=structuredClone(FLOW);for(const tool of flow.tools??[])if(tool.type==='custom')tool.url=u.origin+'/providers/retell/'+account+(tool.name==='slots'?'/tools':'/autonomous');
 if(handoffNumber){if(!/^\+[1-9][0-9]{7,14}$/.test(handoffNumber))throw new Error('INVALID_HANDOFF_NUMBER');flow.nodes=flow.nodes!.filter(n=>n.id!==NODES.fallback);flow.nodes.push({id:NODES.fallback,type:'transfer_call',transfer_destination:{type:'predefined',number:handoffNumber},transfer_option:{type:'cold_transfer',cold_transfer_mode:'sip_invite',show_transferee_as_caller:false,transfer_ring_duration_ms:20000},speak_during_execution:true,instruction:{type:'static_text',text:'Randevu işleminin sonucu doğrulanamadı. Şimdi sizi işletmedeki bir görevliye aktarmayı deniyorum.'},edge:always('transfer_failed','handoff_failed')},{id:'handoff_failed',type:'end',instruction:{type:'static_text',text:'Aktarma başarısız oldu. Randevu oluşturulduğu doğrulanmadı. Lütfen işletmeyi doğrudan arayın.'}});}
 return flow;
}
