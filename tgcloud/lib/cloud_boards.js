import {api,fetch as sdkFetch,EndpointError} from 'sdk';
import {nativeDb} from 'lib/sdk_write_adapter';
import {getNodes} from 'lib/nodes';
import {getSetting,setSetting,setBlocked} from 'lib/store';
import {createBoards} from 'lib/cloud_boards_core';
const boards=createBoards({db:nativeDb,api,getNodes:()=>getNodes(sdkFetch),getSetting,setSetting,setBlocked});
const labels={
 OWNER_ONLY:'هذه اللوحة لحساب المالك فقط.',
 AUTH_DATE_MISSING:'AUTH_DATE_MISSING — لم توفر المنصة تاريخ الجلسة الموقّعة.',
 AUTH_DATE_FORMAT:'AUTH_DATE_FORMAT — صيغة تاريخ الجلسة غير معروفة.',
 AUTH_DATE_FUTURE:'AUTH_DATE_FUTURE — تاريخ الجلسة في المستقبل.',
 REOPEN_TELEGRAM:'أعد فتح اللوحة من Telegram لتجديد المصادقة.',
 CONFIRM_REQUIRED:'يلزم تأكيد الإجراء.',
 INVALID_ACTION:'الإجراء غير صالح.',
 AUDIT_UNAVAILABLE:'سجل العمليات غير متاح؛ لم يبدأ التعديل.',
 ACTION_UNCERTAIN_RELOAD:'تعذر تأكيد نتيجة الإجراء. حدّث اللوحة وافحص السجل؛ لا تكرر الطلب تلقائيًا.'
};
export async function callBoard(kind,input,ctx) {
 try {return await boards[kind](input,ctx);}
 catch(e){if(Object.hasOwn(labels,e?.message))throw new EndpointError(labels[e.message],{code:e.message});throw e;}
}
