import {callBoard} from 'lib/cloud_boards';
export default (input,ctx)=>callBoard('ops',input,ctx);
