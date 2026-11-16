// Telegram Serverless — QMR Proxy v6. Does not change webhooks itself.
import {api} from 'sdk';
import {trackUser,isBlocked,setBlocked,getSetting,setSetting,forgetUser,newBroadcast} from '../lib/store.js';
import {IS_OWNER,text,home,subscriptionScreen,checkSubscription,sendScreen,
  genericScreen,serversScreen,statusScreen,adminScreen,keyboard} from '../lib/ui.js';

function commandAndArg(input) {
  const raw=String(input||'').trim();
  const space=raw.indexOf(' ');
  const command=(space<0?raw:raw.slice(0,space)).split('@')[0].toLowerCase();
  return {command,arg:space<0?'':raw.slice(space+1).trim()};
}
export default async function(message) {
  const uid=Number(message?.from?.id);
  const chatId=message?.chat?.id;
  if (!Number.isSafeInteger(uid)||!chatId||message?.chat?.type!=='private') return;
  const {command,arg}=commandAndArg(message.text);
  if (!command.startsWith('/')) return;
  const owner=IS_OWNER(uid);
  try {await trackUser(uid);} catch (_) { /* DB schema may not yet be migrated */ }
  if (!owner) {
    try { if (await isBlocked(uid)) {
      await api.sendMessage({chat_id:chatId,text:text.blocked}); return;
    }} catch (_) { /* No table yet: subscription is enforced separately */ }
  }

  if (command==='/start') {
    const member=await checkSubscription(uid);
    return sendScreen(chatId,member.ok ? {text:text.welcome,reply_markup:home(owner)}:subscriptionScreen(member));
  }
  if (['/help','/terms','/privacy','/support','/steps','/about','/channel'].includes(command)) {
    return sendScreen(chatId,genericScreen(command.slice(1),owner));
  }
  if (command==='/delete_my_data') {
    if(owner) return sendScreen(chatId,{text:'حذف سجل المالك معطّل لحماية إحصاءات وإعدادات الإدارة. البيانات محفوظة فقط بعد تفعيل قاعدة البيانات.'});
    try {await forgetUser(uid);return sendScreen(chatId,{text:'✅ تم حذف سجل حسابك من قاعدة بيانات QMR Proxy. سيُنشأ سجل جديد إذا استخدمت البوت مجدداً.'});}
    catch (_){return sendScreen(chatId,{text:'⚠️ قاعدة البيانات غير مفعلة أو تعذر الحذف. تواصل مع @QMRSupportbot.'});}
  }
  if (owner) {
    if (command==='/admin'||command==='/panel'||command==='/stats') return sendScreen(chatId,await adminScreen());
    if (command==='/setup') {
      const commands=[
        {command:'start',description:'القائمة الرئيسية'},
        {command:'servers',description:'روابط MTProto المجتمعية'},
        {command:'proxy',description:'روابط الاتصال'},
        {command:'steps',description:'طريقة إعداد الاتصال'},
        {command:'channel',description:'قناة QMR7S'},
        {command:'terms',description:'شروط الاستخدام'},
        {command:'privacy',description:'سياسة الخصوصية'},
        {command:'support',description:'تواصل مع الدعم'},
        {command:'help',description:'الأوامر والمساعدة'},
      ];
      const result=[];
      for (const [label,op] of [
        ['الأوامر',()=>api.setMyCommands({commands})],
        ['الوصف',()=>api.setMyDescription({description:'QMR Proxy من QMR7S — بوت تفاعلي يعرض روابط MTProto العامة، مع قائمة متجددة وخطوات استخدام ودعم فني. الروابط من مشغلين خارجيين؛ لا نضمن السرعة أو الأمان أو تجاوز جميع أنواع الحجب. الدعم: @QMRSupportbot'})],
        ['الوصف القصير',()=>api.setMyShortDescription({short_description:'QMR Proxy | روابط MTProto متجددة • قناة @QMR7S • دعم @QMRSupportbot'})],
      ]) {
        try {await op();result.push('✅ '+label);} catch (_) {result.push('⚠️ تعذر تحديث '+label);}
      }
      return sendScreen(chatId,{text:'⚙️ إعدادات ملف البوت\n\n'+result.join('\n')+'\n\nالصورة الشخصية تحتاج ملف صورة مستقل وإجراء رفع منفصل. لم تُغيّر صورة البوت.'});
    }
    if (command==='/maintenance') {
      if (!['on','off'].includes(arg)) return sendScreen(chatId,{text:'استخدم /maintenance on أو /maintenance off'});
      try {await setSetting('maintenance',arg==='on'?'1':'0');return sendScreen(chatId,{text:'✅ وضع الصيانة: '+(arg==='on'?'مفعل':'متوقف')});}
      catch (_){return sendScreen(chatId,{text:'⚠️ يجب تطبيق ترحيل قاعدة البيانات قبل تغيير حالة الصيانة.'});}
    }
    if (command==='/ban'||command==='/unban') {
      const target=Number(arg);
      if (!Number.isSafeInteger(target)||target<=0||target===uid) return sendScreen(chatId,{text:'⚠️ أرسل معرف مستخدم صالحاً مختلفاً عن حساب المالك. مثال: /ban 123456'});
      try{await setBlocked(target,command==='/ban');return sendScreen(chatId,{text:'✅ '+(command==='/ban'?'حظر':'رفع حظر')+' المستخدم '+target});}
      catch (_){return sendScreen(chatId,{text:'⚠️ قاعدة البيانات غير مهيأة.'});}
    }
    if (command==='/broadcast') {
      if (arg.length<5||arg.length>1600) return sendScreen(chatId,{text:'صيغة الإرسال: /broadcast نص بين 5 و1600 حرف\nستظهر معاينة مع زر التأكيد.'});
      try {
        const b=await newBroadcast(arg);
        return sendScreen(chatId,{text:'📢 معاينة إشعار #'+b.id+'\n\n'+arg+'\n\nهل تريد بدء الإرسال؟ (15 مستخدماً كحد أقصى لكل دفعة)',reply_markup:keyboard([
          [{text:'✅ تأكيد الإرسال',callback_data:'q:a:bcast:'+b.id,style:'success'}],
          [{text:'❌ إلغاء المسودة',callback_data:'q:a:cancel:'+b.id,style:'danger'}]
        ])});
      } catch (_) {return sendScreen(chatId,{text:'⚠️ قاعدة البيانات غير مهيأة. لا يمكن إنشاء إشعار الآن.'});}
    }
  }
  if (command==='/servers'||command==='/proxy') {
    const check=await checkSubscription(uid);
    if (!check.ok) return sendScreen(chatId,subscriptionScreen(check));
    if (!owner) {try{if(await getSetting('maintenance','0')==='1')return sendScreen(chatId,{text:text.unavailable});}catch(_){}}
    const requested=Number(arg||'1');
    return sendScreen(chatId,await serversScreen(requested));
  }
  return sendScreen(chatId,genericScreen('help',owner));
}
