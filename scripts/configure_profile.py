#!/usr/bin/env python3
"""QMR Proxy bot profile release, with local hidden token prompt and explicit approval.
Requires a NEW BotFather token. Does not modify webhook, Serverless or chats.
Default is dry-run. Only --apply sends requests to Telegram.
"""
import argparse
import getpass
import http.client
import json
import pathlib
import secrets
import sys
from datetime import datetime,timezone

BOT_ID=9239734904
USERNAME='qmrproxybot'
WEBAPP='https://qmr-proxy.alialnyamy675.chatgpt.site'
NAME='QMR Proxy | QMR7S'
SHORT='روابط MTProto متجددة وMini App تفاعلي من QMR7S. القناة @QMR7S • الدعم @QMRSupportbot'
LONG=('QMR Proxy من QMR7S — دليل تفاعلي لإدارة روابط بروكسي MTProto وفتحها داخل تيليجرام. '
      'استعرض الروابط المجتمعية، استخدم التطبيق المصغّر، وتعرّف على خطوات الإعداد والخصوصية. '
      'الروابط من مشغّلين خارجيين وليست خوادم خاصة بنا؛ قد تظهر قنوات ترويجية، ولا نضمن سرعة الاتصال أو تجاوزه للحظر في جميع الشبكات. '
      'التحديثات: @QMR7S | الدعم: @QMRSupportbot')
PUBLIC_COMMANDS=[
  {'command':'start','description':'القائمة الرئيسية'},
  {'command':'app','description':'فتح تطبيق QMR Proxy'},
  {'command':'servers','description':'بروكسيات MTProto المتجددة'},
  {'command':'steps','description':'طريقة الاتصال والإعداد'},
  {'command':'faq','description':'الأسئلة الشائعة'},
  {'command':'safety','description':'إرشادات الأمان'},
  {'command':'terms','description':'شروط الاستخدام'},
  {'command':'privacy','description':'سياسة الخصوصية'},
  {'command':'support','description':'التواصل مع الدعم'},
  {'command':'help','description':'دليل الاستخدام'}]
OWNER_COMMANDS=PUBLIC_COMMANDS + [
  {'command':'admin','description':'لوحة المالك'},
  {'command':'stats','description':'إحصاءات الاستخدام'},
  {'command':'broadcast','description':'معاينة إشعار إداري'},
  {'command':'maintenance','description':'إدارة الصيانة'}]
OWNER_ID=6246913670
PHOTO=pathlib.Path(__file__).resolve().parents[1]/'assets'/'QMRProxy_avatar_512.jpg'
assert len(SHORT)<=120 and len(LONG)<=512

class BotAPIError(Exception):
    pass

def call(token,method,payload=None,photo=None):
    # URL path contains token, but it is NEVER printed, persisted or logged.
    connection=http.client.HTTPSConnection('api.telegram.org',timeout=25)
    try:
        if photo is None:
            body=json.dumps(payload or {},ensure_ascii=False).encode('utf8')
            headers={'Content-Type':'application/json','Connection':'close'}
        else:
            if not photo.is_file() or photo.suffix.lower() not in ('.jpg','.jpeg') or photo.stat().st_size>5_000_000:
                raise BotAPIError('Bot profile photo must be a JPG file no larger than 5 MB.')
            boundary='----qmr'+secrets.token_hex(18)
            photo_data=photo.read_bytes()
            parts=[f'--{boundary}\r\nContent-Disposition: form-data; name="photo"\r\n\r\n'.encode(),
                   json.dumps({'type':'static','photo':'attach://avatar'},ensure_ascii=False).encode(),b'\r\n',
                   f'--{boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="profile.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode(),photo_data,
                   f'\r\n--{boundary}--\r\n'.encode()]
            body=b''.join(parts)
            headers={'Content-Type':f'multipart/form-data; boundary={boundary}','Connection':'close'}
        connection.request('POST','/bot'+token+'/'+method,body=body,headers=headers)
        response=connection.getresponse()
        body=response.read(4_000_000)
        result=json.loads(body)
        if response.status!=200 or result.get('ok') is not True:
            raise BotAPIError(f'{method} returned HTTP {response.status}; {result.get("description","unknown Telegram API error")}')
        return result.get('result')
    finally:
        connection.close()

def main():
    p=argparse.ArgumentParser(description='Local, secret-free QMR Proxy Bot API profile setup')
    p.add_argument('--apply',action='store_true',help='Perform updates with a fresh token entered privately')
    p.add_argument('--skip-photo',action='store_true',help='Preserve current bot photo')
    args=p.parse_args()
    print('Target:',USERNAME, BOT_ID)
    print('Mini App:',WEBAPP)
    print('Name:',NAME)
    print('Short description:',SHORT)
    print('Description:',LONG)
    print('Public commands:',', '.join(x['command'] for x in PUBLIC_COMMANDS))
    print('Owner ID:',OWNER_ID)
    print('Profile photo:',str(PHOTO.name),'(JPG required)')
    print('Webhook and Serverless are NEVER modified by this script.')
    if not args.apply:
        print('\nDRY RUN: no Telegram API requests were sent. First revoke the token exposed in the chat, then use --apply.')
        return 0
    token=getpass.getpass('NEW rotated BotFather token (hidden, never saved): ').strip()
    if not token or ':' not in token:
        print('A new valid BotFather token is required.',file=sys.stderr);return 2
    try:
        me=call(token,'getMe')
        if me.get('id')!=BOT_ID or me.get('username','').lower()!=USERNAME:
            print('ERROR: Token is for a different bot. Nothing was modified.',file=sys.stderr);return 2
        print('Verified correct bot identity:',me.get('username'),me.get('id'))
        # Save non-secret BEFORE state for recovery, without Telegram token.
        old={}
        for label,method in [('name','getMyName'),('short','getMyShortDescription'),('description','getMyDescription'),('commands','getMyCommands'),('menu','getChatMenuButton')]:
            try: old[label]=call(token,method)
            except BotAPIError: old[label]={'note':'not_available'}
        backup_dir=pathlib.Path(__file__).resolve().parents[1]/'.tgcloud'/'profile-backups'
        backup_dir.mkdir(parents=True,exist_ok=True)
        backup_path=backup_dir/('profile-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
        backup_path.write_text(json.dumps(old,ensure_ascii=False,indent=2),encoding='utf8')
        try: backup_path.chmod(0o600)
        except OSError: pass
        print('Saved old profile backup locally:',backup_path.name)
        updates=[
            ('setMyName',{'name':NAME}),
            ('setMyShortDescription',{'short_description':SHORT}),
            ('setMyDescription',{'description':LONG}),
            ('setMyCommands',{'commands':PUBLIC_COMMANDS}),
            ('setMyCommands',{'commands':OWNER_COMMANDS,'scope':{'type':'chat','chat_id':OWNER_ID}}),
            ('setChatMenuButton',{'menu_button':{'type':'web_app','text':'فتح QMR Proxy','web_app':{'url':WEBAPP}}}),
        ]
        failed=[]
        for method,params in updates:
            try:
                call(token,method,params)
                print('OK',method,'(owner scope)' if params.get('scope') else '')
            except Exception as exc:
                # Never render an exception that could contain the URL with the token.
                print('FAILED',method,'; inspect internet connection / Telegram permissions')
                failed.append(method)
        if not args.skip_photo:
            try:
                call(token,'setMyProfilePhoto',photo=PHOTO)
                print('OK setMyProfilePhoto (512x512 JPG)')
            except Exception:
                print('FAILED setMyProfilePhoto; can also upload via @BotFather')
                failed.append('setMyProfilePhoto')
        for method in ['getChatMenuButton','getMyDescription','getMyShortDescription']:
            try:
                result=call(token,method)
                print('VERIFIED',method, bool(result))
            except Exception:
                failed.append('verify:'+method)
        print('Webhook unchanged. TGCloud source unchanged.')
        if failed:
            print('Some actions failed:',', '.join(failed));return 1
        print('PROFILE UPDATE COMPLETE. For profile Open App button and preview gallery, enable MAIN MINI APP in @BotFather separately.')
        return 0
    except Exception:
        print('Telegram connection failed or credentials rejected; no token was logged.',file=sys.stderr)
        return 1

if __name__=='__main__':sys.exit(main())
