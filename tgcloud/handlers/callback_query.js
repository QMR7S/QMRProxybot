// Telegram Serverless inline callbacks; every privileged action rechecks owner ID.
import {api} from 'sdk';
import {isBlocked,getSetting,setSetting,getStats,broadcastById,broadcastBatch,cancelBroadcast} from '../lib/store.js';
import {IS_OWNER,text,home,checkSubscription,subscriptionScreen,
  sendScreen,genericScreen,serversScreen,statusScreen,adminScreen,
  broadcastIntro,keyboard} from '../lib/ui.js';

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
  const owner=IS_OWNER(uid);
  if (ownerOnly(data) && !owner) return ack(query,'غير مخوّل بهذه العملية');
  if (!owner) {
    try {if(await isBlocked(uid)) {await ack(query);return sendScreen(chatId,{text:text.blocked},messageId);}}
    catch (_) { /* migration not yet applied */ }
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
  if (!owner && (data.startsWith('q:servers:')||data==='q:status')) {
    try {if(await getSetting('maintenance','0')==='1') {await ack(query);return sendScreen(chatId,{text:text.unavailable},messageId);}}
    catch (_) { /* default: no maintenance if DB not yet initialized */ }
  }
  await ack(query);
  if (data==='q:home') return sendScreen(chatId,{text:text.welcome,reply_markup:home(owner)},messageId);
  if (data.startsWith('q:servers:')) {
    const page=Number(data.split(':')[2]);
    return sendScreen(chatId,await serversScreen(page),messageId);
  }
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
  if (data==='q:a:broadcast') return sendScreen(chatId,broadcastIntro(),messageId);
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
    const id=Number(data.split(':')[3]);
    if (!Number.isSafeInteger(id)||id<=0) return;
    try {
      const b=await broadcastById(id);
      if (!b || !['draft','sending'].includes(b.status)) return sendScreen(chatId,{text:'هذه المسودة غير موجودة أو انتهت بالفعل.'},messageId);
      const result=await broadcastBatch(id,api);
      return sendScreen(chatId,{text:'📢 الإشعار #'+id+'\n\n✅ أُرسل: '+result.sent+'\n⚠️ تعذر التسليم: '+result.failed+'\n'+(result.done?'🏁 انتهى الإرسال.':'➡️ توجد دفعات متبقية، اضغط متابعة لإرسال 15 أخرى.'),reply_markup:broadcastButtons(id,!result.done)},messageId);
    }catch(_){return sendScreen(chatId,{text:'⚠️ تعذّر الإرسال؛ قد تكون قاعدة البيانات غير مهيأة. راجع لوحة المالك.'},messageId);}
  }
}
