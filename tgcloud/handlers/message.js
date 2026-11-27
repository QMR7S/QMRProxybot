// Telegram Serverless — QMR Proxy v6. Does not change webhooks itself.
import {api,fetch as sdkFetch} from 'sdk';
import {notifications,notificationHelp,notificationScreen,notificationError} from 'lib/notification_runtime';
import {getExtraNodes,extraPage,qualityUnavailable} from 'lib/extra_cloud';
import {trackUser,isBlocked,setBlocked,getSetting,setSetting,forgetUser} from 'lib/store';
import {IS_OWNER,text,home,subscriptionScreen,checkSubscription,sendScreen,
  genericScreen,serversScreen,statusScreen,adminScreen,keyboard} from 'lib/ui';

function commandAndArg(input) {
  const raw=String(input||'').trim();
  const space=raw.indexOf(' ');
  const command=(space<0?raw:raw.slice(0,space)).split('@')[0].toLowerCase();
  return {command,arg:space<0?'':raw.slice(space+1).trim()};
}
export default async function(message) {
  const uid=Number(message?.from?.id);
  const chatId=message?.chat?.id;
  if (!Number.isSafeInteger(uid)||uid<=0||Number(chatId)!==uid||message?.chat?.type!=='private') return;
  const {command,arg}=commandAndArg(message.text);
  if (!command.startsWith('/')) return;
  const owner=IS_OWNER(uid);
  // Privacy requests must be available even when a user is blocked.
  if(command==='/delete_my_data'){
    if(owner)return sendScreen(chatId,{text:'حذف سجل المالك غير متاح عبر الأمر العام.'});
    try{await notifications.forget(uid);await forgetUser(uid);return sendScreen(chatId,{text:'✅ حُذف سجل استخدامك واشتراك الإشعارات وسجلات التسليم المحسومة. سيُنشأ سجل استخدام جديد إذا استخدمت البوت لاحقًا.'});}
    catch(e){return sendScreen(chatId,notificationError(e));}
  }
  if(command==='/notifications'&&arg==='off'){
    try{await notifications.preference(uid,false);return sendScreen(chatId,{text:'✅ أوقفت الإشعارات المستقبلية. قد تكون رسالة بدأ إرسالها بالفعل في الطريق.'});}
    catch(e){return sendScreen(chatId,notificationError(e));}
  }
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
  if (['/help','/terms','/privacy','/support','/steps','/about','/channel','/app','/faq','/safety'].includes(command)) {
    return sendScreen(chatId,genericScreen(command.slice(1),owner));
  }
  if(command==='/notifications'){
    if(arg!=='on')return sendScreen(chatId,{text:'إشعارات اختيارية: /notifications on للتفعيل أو /notifications off للإلغاء.'});
    const check=await checkSubscription(uid);
    if(!check.ok)return sendScreen(chatId,subscriptionScreen(check));
    try{await notifications.preference(uid,true);return sendScreen(chatId,{text:'✅ تم تفعيل الإشعارات الاختيارية. يمكنك إيقافها في أي وقت: /notifications off'});}
    catch(e){return sendScreen(chatId,notificationError(e));}
  }
  if (owner) {
    if (command==='/admin'||command==='/panel'||command==='/stats') return sendScreen(chatId,await adminScreen());
    if (command==='/setup') {
      return sendScreen(chatId,{text:'⚙️ إعداد الملف الشخصي للبوت\n\nلرفع صورة البوت والوصف وتفعيل زر Mini App، استخدم السكربت الآمن scripts/configure_profile.py من Termux بعد تدوير التوكن المكشوف عبر BotFather.\n\nلا ترسل التوكن إلى المحادثة أو تضعه في GitHub. السكربت يتحقق من هوية البوت، يحفظ نسخة محلية من المعلومات القديمة، ولا يغيّر Webhook.\n\nيمكن تفعيل Main Mini App وصور المعاينة في @BotFather.'});
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
    if(['/broadcast','/broadcast_test','/broadcast_status','/broadcast_abandon'].includes(command)){
      try{
        if(command==='/broadcast'||command==='/broadcast_test'){
          if(!arg)return sendScreen(chatId,notificationHelp);
          return sendScreen(chatId,notificationScreen(await notifications.create(uid,message.message_id,arg,command==='/broadcast_test'?'canary':'optin'),arg));
        }
        if(command==='/broadcast_status'&&/^[1-9][0-9]*$/.test(arg))return sendScreen(chatId,notificationScreen(await notifications.summary(uid,Number(arg))));
        const match=/^([1-9][0-9]*) CONFIRM$/.exec(arg);
        if(command==='/broadcast_abandon'&&match)return sendScreen(chatId,notificationScreen(await notifications.abandon(uid,Number(match[1]))));
        return sendScreen(chatId,notificationHelp);
      }catch(e){return sendScreen(chatId,notificationError(e));}
    }
  }
  if (['/extra','/servers_extra','/best','/quality'].includes(command)) {
    const check=await checkSubscription(uid);
    if(!check.ok)return sendScreen(chatId,subscriptionScreen(check));
    if(!owner){try{if(await getSetting('maintenance','0')==='1')return sendScreen(chatId,{text:text.unavailable});}catch(_){return sendScreen(chatId,{text:text.unavailable});}}
    return sendScreen(chatId,['/best','/quality'].includes(command)?qualityUnavailable():extraPage(await getExtraNodes(sdkFetch),arg||1));
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
