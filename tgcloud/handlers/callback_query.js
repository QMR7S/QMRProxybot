// Telegram Serverless inline callbacks; every privileged action rechecks owner ID.
import {api,fetch as sdkFetch} from 'sdk';
import {notifications,notificationHelp,notificationScreen,notificationError} from 'lib/notification_runtime';
import {getExtraNodes,extraPage,qualityUnavailable} from 'lib/extra_cloud';
import {ownerCallbackAllowed} from 'lib/owner_callback_guard';
import {isBlocked,getSetting,setSetting,getStats,broadcastById,cancelBroadcast} from 'lib/store';
import {IS_OWNER,text,home,checkSubscription,subscriptionScreen,
  sendScreen,genericScreen,serversScreen,statusScreen,adminScreen,
  broadcastIntro,keyboard} from 'lib/ui';

const ownerOnly = data => data==='q:admin'||data.startsWith('q:a:');
async function ack(query,msg) {
  try {await api.answerCallbackQuery({callback_query_id:query.id,...(msg?{text:msg,show_alert:false}:{})});}
  catch (_) { /* expired query, safe to continue */ }
}
function confirmMaintenance(next) {
  return {text:'🛠 تأكيد إعداد الصيانة\n\n'+
    (next==='1'?'سيُوقف هذا الإجراء وصول المشتركين إلى قوائم البروكسي داخل البوت مؤقتاً.':'سيعيد هذا الإجراء وصول المشتركين إلى قوائم البروكسي داخل البوت.')+
    '\n\nهل تريد المتابعة؟',reply_markup:keyboard([
      [{text:'✅ تأكيد',callback_data:'q:a:maint:ok:'+next,style:'success'}],
      [{text:'↩ إلغاء',callback_data:'q:admin'}]
    ])};
}
function broadcastButtons(id,more) {
  return keyboard([
    ...(more?[[{text:'➡️ متابعة إرسال الدفعة التالية',callback_data:'q:a:bcast:'+id,style:'primary'}]]:[]),
    [{text:'⚙️ لوحة المالك',callback_data:'q:admin'}]
  ]);
}
export default async function(query) {
  const uid=Number(query?.from?.id);
  const chatId=query?.message?.chat?.id;
  const messageId=query?.message?.message_id;
  const data=typeof query?.data==='string'?query.data:'';
  if (!Number.isSafeInteger(uid)||!chatId||!messageId||!data.startsWith('q:')) {
    return ack(query,'زر غير مدعوم');
  }
  if(uid<=0||query?.message?.chat?.type!=='private'||Number(chatId)!==uid)return ack(query,'غير مخوّل بهذه العملية');
  const owner=IS_OWNER(uid);
  // Owner controls, including q:admin, must run only inside the owner's
  // private bot chat. Reject group/supergroup callbacks even from the owner.
  // This prevents admin state and message previews leaking into group chats.
  if (ownerOnly(data) && !ownerCallbackAllowed(query, IS_OWNER)) return ack(query,'غير مخوّل بهذه العملية');
  if (!owner) {
    try {if(await isBlocked(uid)) {await ack(query);return sendScreen(chatId,{text:text.blocked},messageId);}}
    catch (_) {await ack(query);return sendScreen(chatId,{text:text.unavailable},messageId);}
  }
  if (data==='q:verify') {
    const membership=await checkSubscription(uid);
    await ack(query,membership.ok?'تم التحقق من الاشتراك':'لم يكتمل التحقق');
    return sendScreen(chatId,membership.ok?{text:text.welcome,reply_markup:home(owner)}:subscriptionScreen(membership),messageId);
  }
  if (!owner && !['q:help','q:terms','q:privacy','q:steps','q:about','q:support','q:channel','q:faq','q:safety','q:app'].includes(data)) {
    const membership=await checkSubscription(uid);
    if (!membership.ok) {await ack(query);return sendScreen(chatId,subscriptionScreen(membership),messageId);}
  }
  if (!owner && (data.startsWith('q:servers:')||data.startsWith('q:extra:')||data==='q:quality'||data==='q:status')) {
    try {if(await getSetting('maintenance','0')==='1') {await ack(query);return sendScreen(chatId,{text:text.unavailable},messageId);}}
    catch (_) {await ack(query);return sendScreen(chatId,{text:text.unavailable},messageId);}
  }
  await ack(query);
  if (data==='q:home') return sendScreen(chatId,{text:text.welcome,reply_markup:home(owner)},messageId);
  if (data.startsWith('q:servers:')) {
    const page=Number(data.split(':')[2]);
    return sendScreen(chatId,await serversScreen(page),messageId);
  }
  if (data.startsWith('q:extra:')) return sendScreen(chatId,extraPage(await getExtraNodes(sdkFetch),data.split(':')[2]),messageId);
  if (data==='q:quality') return sendScreen(chatId,qualityUnavailable(),messageId);
  if (data==='q:status') return sendScreen(chatId,await statusScreen(),messageId);
  for (const section of ['help','steps','faq','safety','terms','privacy','about','channel','support','app']) {
    if (data==='q:'+section) return sendScreen(chatId,genericScreen(section,owner),messageId);
  }
  if (!owner) return sendScreen(chatId,genericScreen('help',owner),messageId);
  if (data==='q:admin') return sendScreen(chatId,await adminScreen(),messageId);
  if (data==='q:a:stats') {
    try {
      const s=await getStats();
      return sendScreen(chatId,{text:'📊 إحصاءات QMR Proxy\n\nالمستخدمون المسجلون: '+s.total+'\nنشطون آخر 7 أيام: '+s.active+'\nالمحظورون: '+s.blocked+'\n\nلا نخزّن نصوص الرسائل أو أرقام الهواتف.',reply_markup:keyboard([[{text:'⚙️ لوحة المالك',callback_data:'q:admin'}]])},messageId);
    } catch (_) {return sendScreen(chatId,{text:'⚠️ قاعدة البيانات غير مُرحَّلة بعد. لا توجد إحصاءات يمكن تأكيدها.',reply_markup:keyboard([[{text:'⚙️ لوحة المالك',callback_data:'q:admin'}]])},messageId);}
  }
  if (data==='q:a:source') return sendScreen(chatId,await statusScreen(),messageId);
  if (data==='q:a:channel') return sendScreen(chatId,{text:'📣 الاشتراك الإجباري\n\nالقناة: @QMR7S\nتحقق الأعضاء: Telegram getChatMember\n\nيجب أن يكون @QMRProxybot مشرفاً في القناة لكي يكون فحص العضوية موثوقاً.\n\nمالك البوت مستثنى من شرط الاشتراك لإدارة الطوارئ.',reply_markup:keyboard([[{text:'⚙️ لوحة المالك',callback_data:'q:admin'}]])},messageId);
  if (data==='q:a:broadcast') return sendScreen(chatId,notificationHelp,messageId);
  if(data.startsWith('q:a:n13:')){
    const match=/^q:a:n13:(confirm|step|cancel|status):([1-9][0-9]*)(?::(0|[1-9][0-9]*))?$/.exec(data);
    if(!match)return;
    const id=Number(match[2]);if(!Number.isSafeInteger(id)||((match[1]==='step')!==Boolean(match[3])))return;
    const seq=match[3]===undefined?undefined:Number(match[3]);if(seq!==undefined&&!Number.isSafeInteger(seq))return;
    try{const action=match[1]==='status'?'summary':match[1];return sendScreen(chatId,notificationScreen(await notifications[action](uid,id,seq)),messageId);}
    catch(e){return sendScreen(chatId,notificationError(e),messageId);}
  }
  if (data==='q:a:maintenance') {
    let next='1';
    try {next=(await getSetting('maintenance','0'))==='1'?'0':'1';}
    catch (_) {return sendScreen(chatId,{text:'⚠️ قاعدة البيانات غير مهيأة. شغّل ترحيل الجداول الإضافية أولاً.'},messageId);}
    return sendScreen(chatId,confirmMaintenance(next),messageId);
  }
  if (data.startsWith('q:a:maint:ok:')) {
    const value=data.split(':')[4];
    if (!['0','1'].includes(value)) return;
    try {await setSetting('maintenance',value);return sendScreen(chatId,await adminScreen(),messageId);}
    catch (_) {return sendScreen(chatId,{text:'⚠️ تعذر تحديث إعداد الصيانة؛ تحقق من قاعدة البيانات.'},messageId);}
  }
  if (data.startsWith('q:a:cancel:')) {
    const id=Number(data.split(':')[3]);
    if (!Number.isSafeInteger(id)||id<=0) return;
    try {const b=await broadcastById(id);if(b?.status==='draft') await cancelBroadcast(id);
      return sendScreen(chatId,{text:'تم إلغاء المسودة إذا لم يبدأ إرسالها.',reply_markup:keyboard([[{text:'⚙️ لوحة المالك',callback_data:'q:admin'}]])},messageId);
    }catch(_){return sendScreen(chatId,{text:'تعذر إلغاء المسودة.'},messageId);}
  }
  if (data.startsWith('q:a:bcast:')) {
    // SAFETY HOLD (review branch): legacy v6 cursor-first dispatcher can
    // permanently skip users or overlap with another callback invocation.
    // Do not send or mutate the old campaign until v13 native handler migration,
    // private snapshot validation and cloud-stage dry run have passed.
    return sendScreen(chatId,{
      text:'⛔ إرسال الإشعارات متوقف مؤقتًا لحماية البيانات ومنع تكرار الإرسال أو فقدان المستلمين. لا تغيّر المسودة؛ يلزم إكمال الترحيل الآمن.',
      reply_markup:keyboard([[{text:'⚙️ لوحة المالك',callback_data:'q:admin'}]])
    },messageId);
  }
}
