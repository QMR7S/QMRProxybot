import {db,api} from 'sdk';
import {makeBroadcastControl} from 'lib/broadcast_control';
import {OWNER_ID} from 'lib/ui';
export const notifications=makeBroadcastControl(db,(uid,content)=>api.sendMessage({chat_id:uid,text:'📣 QMR Proxy\n\n'+content,link_preview_options:{is_disabled:true}}),OWNER_ID);
export const notificationHelp={text:'📣 إشعارات QMR Proxy\n\n/broadcast_test نص — مسودة اختبار للمالك فقط\n/broadcast نص — مسودة للمشتركين طوعًا بعد نجاح الاختبار\n/broadcast_status رقم — حالة المسودة والتسليم\n/broadcast_abandon رقم CONFIRM — إيقاف نهائي للمحاولة غير المحسومة بعد خمس دقائق، دون إعادة إرسال\n\nالمستخدم: /notifications on أو /notifications off. لا تُرسل المسودة حتى تأكيدها ثم طلب الإرسال.',reply_markup:{inline_keyboard:[[{text:'لوحة المالك',callback_data:'q:admin'}]]}};
export function notificationScreen(d,preview=''){
 const states={preparing:'قيد التجهيز',draft:'مسودة',sending:'مؤكد · إرسال يدوي',done:'منتهٍ',cancelled:'ملغى'};
 const {pending,attempting,sent,unknown,skipped}=d.counts;
 const rows=[];
 if(d.state==='draft')rows.push([{text:'تأكيد المسودة (دون إرسال)',callback_data:'q:a:n13:confirm:'+d.id}]);
 if(d.state==='sending'&&pending>0&&!attempting&&!unknown)rows.push([{text:'إرسال للمستلم التالي',callback_data:'q:a:n13:step:'+d.id+':'+d.stepSeq}]);
 if(['draft','sending','preparing'].includes(d.state))rows.push([{text:'إلغاء',callback_data:'q:a:n13:cancel:'+d.id}]);
 rows.push([{text:'تحديث الحالة',callback_data:'q:a:n13:status:'+d.id}],[{text:'لوحة المالك',callback_data:'q:admin'}]);
 return {text:'📣 حملة #'+d.id+' · '+(d.scope==='canary'?'اختبار المالك فقط':'اشتراك اختياري')+'\nالحالة: '+(states[d.state]||d.state)+'\nالمستلمون: '+d.total+'\nبانتظار: '+pending+' | مؤكد: '+sent+'\nقيد المحاولة: '+attempting+' | غير محسوم: '+unknown+' | مستبعد: '+skipped+(preview?'\n\nمعاينة:\n'+preview:'')+(attempting||unknown?'\n\nتوقف الإرسال؛ لا تعد المحاولة غير المحسومة. استخدم أمر الإلغاء أو المصالحة من دليل الإشعارات.':''),reply_markup:{inline_keyboard:rows}};
}
export function notificationError(e){
 const labels={CANARY_REQUIRED:'يجب نجاح اختبار المالك أولاً: /broadcast_test نص',INVALID_DRAFT:'أرسل نصًا من 1 إلى 3000 محرف.',NOT_ELIGIBLE:'لا يمكن تفعيل الإشعارات لهذا الحساب.',IN_FLIGHT_TRY_LATER:'توجد محاولة تسليم قيد الحسم. أعد طلب حذف بياناتك بعد انتهائها.',NOT_FOUND:'رقم الحملة غير موجود.',OWNER_ONLY:'غير مصرح.'};
 return {text:'⚠️ '+(labels[e?.message]||'تعذر تأكيد العملية؛ افحص حالة الحملة قبل أي إعادة محاولة.')};
}
