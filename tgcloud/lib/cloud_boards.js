import {db,api,fetch as sdkFetch,EndpointError} from 'sdk';
import {getNodes} from 'lib/nodes';
import {getSetting,setSetting,setBlocked} from 'lib/store';
import {createBoards} from 'lib/cloud_boards_core';
const boards=createBoards({db,api,getNodes:()=>getNodes(sdkFetch),getSetting,setSetting,setBlocked});
const labels={
 OWNER_ONLY:'هذه اللوحة لحساب المالك فقط.',
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
