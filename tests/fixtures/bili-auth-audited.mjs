import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const OWNER_UID='13461350';
export const ROOT=process.env.DSH_QQ_BRIDGE_ROOT||'C:/DSH/DaFeiYu';
export const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export const API='https://api.bilibili.com';
export const HEADERS={'User-Agent':UA,Referer:'https://www.bilibili.com/',Origin:'https://www.bilibili.com',Accept:'application/json'};
const HOSTS=new Set(['api.bilibili.com','api.vc.bilibili.com','passport.bilibili.com','comment.bilibili.com']);
const COOKIE_NAMES=new Set(['SESSDATA','bili_jct','DedeUserID','DedeUserID__ckMd5','buvid3','buvid4']);
const MIXIN=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
export function fail(code,message){const error=new Error(code+'：'+message);error.code=code;return error;}
export function parseApiJson(text){return JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|(-?\d{16,})(?=[,\]}\s])/g,(whole,quoted,number)=>quoted||(!Number.isSafeInteger(Number(number))?JSON.stringify(number):number)));}
export function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(error){if(error.code==='ENOENT')return fallback;throw fail('BILI_STATE_INVALID','本地状态无法读取');}}
export function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
export function signWbi(params,img,sub,seconds=Math.floor(Date.now()/1000)){
  const stem=value=>new URL(value).pathname.split('/').at(-1).split('.')[0];
  const raw=stem(img)+stem(sub),key=MIXIN.map(i=>raw[i]).join('').slice(0,32);
  const sorted=Object.fromEntries(Object.entries({...params,wts:seconds}).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,String(v).replace(/[!'()*]/g,'')]));
  const query=Object.entries(sorted).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
  return {...sorted,w_rid:createHash('md5').update(query+key).digest('hex')};
}
export class BiliAuth {
  constructor({root=ROOT,fetchImpl=globalThis.fetch,clock=Date.now}={}){Object.assign(this,{root,fetchImpl,clock});this.credentialFile=path.join(root,'配置文件','凭据','bilibili.session.json');this.loginFile=path.join(root,'配置文件','凭据','bilibili.login.json');this.configFile=path.join(root,'配置文件','bilibili.json');this.keys=null;}
  config(){const cfg=readJson(this.configFile,{});if(cfg.ownerUid&&String(cfg.ownerUid)!==OWNER_UID)throw fail('BILI_OWNER_MISMATCH','私信对象配置与维护者指定UID不一致');return cfg;}
  session(required=true){
    const s=readJson(this.credentialFile,null);if(!s){if(required)throw fail('BILI_LOGIN_REQUIRED','请维护者扫码登录大肥鱼独立账号');return null;}
    const configured=this.config().accountUid;
    if(!/^[1-9][0-9]{0,18}$/.test(String(s.mid))||String(s.mid)===OWNER_UID||String(s.cookies?.DedeUserID)!==String(s.mid)||(configured&&String(configured)!==String(s.mid))||!s.cookies?.SESSDATA||!s.cookies?.bili_jct)throw fail('BILI_ACCOUNT_MISMATCH','独立账号凭据不一致，需重新登录');
    return s;
  }
  cookieHeader(url,required=true){
    const u=new URL(url);if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.username||u.password)throw fail('BILI_HOST_DENIED','不向该地址提供账号凭据');
    const s=this.session(required);if(!s)return '';
    return Object.entries(s.cookies).filter(([k,v])=>COOKIE_NAMES.has(k)&&typeof v==='string'&&!/[\r\n;]/.test(v)).map(([k,v])=>k+'='+v).join('; ');
  }
  async request(url,{params={},data=null,auth=true,wbi=false,tolerate=[]}={}){
    const u=new URL(url);if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.username||u.password)throw fail('BILI_HOST_DENIED','请求目标不在B站接口列表');
    if(wbi){if(!this.keys||this.clock()-this.keys.at>3600000){const nav=await this.request(API+'/x/web-interface/nav',{auth,tolerate:[-101]});this.keys={...nav.data?.wbi_img,at:this.clock()};}if(!this.keys.img_url||!this.keys.sub_url)throw fail('BILI_WBI_UNAVAILABLE','无法取得签名参数');params=signWbi(params,this.keys.img_url,this.keys.sub_url);}
    for(const [k,v]of Object.entries(params))u.searchParams.set(k,String(v));
    const headers={...HEADERS};if(auth)headers.Cookie=this.cookieHeader(u.href);
    if(data){headers['Content-Type']='application/x-www-form-urlencoded';if(auth){const csrf=this.session().cookies.bili_jct;data={...data,csrf,csrf_token:csrf};}}
    let response;try{response=await this.fetchImpl(u,{method:data?'POST':'GET',headers,body:data?new URLSearchParams(data):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw fail('BILI_NETWORK','连接失败，写操作结果可能未知，请先查记录，不自动重发');}
    if(response.status===412||response.status===429)throw fail('BILI_RISK','平台限制请求，请稍后再试');
    let json;try{json=parseApiJson(await response.text());}catch{throw fail('BILI_BAD_RESPONSE','接口未返回有效JSON');}
    if(!response.ok)throw fail('BILI_HTTP','平台HTTP错误 '+response.status);
    if(Number(json.code)!==0&&!tolerate.includes(Number(json.code)))throw fail('BILI_API_'+String(json.code),'平台未接受请求：'+String(json.message||'').slice(0,180));
    return json;
  }
  async status(){
    const session=this.session(false);if(!session)return {loggedIn:false,ownerUid:OWNER_UID,loginRequired:true};
    const j=await this.request(API+'/x/web-interface/nav');
    if(!j.data?.isLogin||String(j.data.mid)!==String(session.mid))throw fail('BILI_LOGIN_EXPIRED','登录态失效或账号发生变化');
    return {loggedIn:true,uid:String(j.data.mid),name:j.data.uname,level:j.data.level_info?.current_level,ownerUid:OWNER_UID,dmMode:'owner_only'};
  }
  async loginStart(){
    if(this.session(false))throw fail('BILI_ALREADY_CONFIGURED','已经配置账号；更换账号须由维护者处理');
    const j=await this.request('https://passport.bilibili.com/x/passport-login/web/qrcode/generate',{auth:false,params:{source:'main-fe-header'}});
    if(!j.data?.qrcode_key||!j.data?.url)throw fail('BILI_QR_INVALID','二维码接口缺少必要字段');
    writeJson(this.loginFile,{key:j.data.qrcode_key,createdAt:this.clock()});
    return {url:j.data.url,expiresInSeconds:180,ownerUid:OWNER_UID};
  }
  async loginPoll(){
    if(this.session(false))return this.status();
    const pending=readJson(this.loginFile,null);if(!pending)throw fail('BILI_QR_MISSING','请先生成二维码');
    const url=new URL('https://passport.bilibili.com/x/passport-login/web/qrcode/poll');url.searchParams.set('qrcode_key',pending.key);url.searchParams.set('source','main-fe-header');
    const response=await this.fetchImpl(url,{headers:HEADERS,redirect:'error',signal:AbortSignal.timeout(20000)});
    const json=parseApiJson(await response.text());if(Number(json.code)!==0)throw fail('BILI_LOGIN_ERROR','二维码状态读取失败');
    const d=json.data;if(d.code!==0)return {loggedIn:false,state:({86101:'waiting_scan',86090:'waiting_confirmation',86038:'expired'})[d.code]||'pending',code:d.code};
    const cookies={};for(const header of response.headers.getSetCookie()){const pair=header.split(';')[0],i=pair.indexOf('=');const k=pair.slice(0,i);if(COOKIE_NAMES.has(k))cookies[k]=pair.slice(i+1);}
    if(d.url){const callback=new URL(d.url);for(const [k,v]of callback.searchParams)if(COOKIE_NAMES.has(k)&&!cookies[k])cookies[k]=k==='SESSDATA'?encodeURIComponent(v):v;}
    const mid=String(cookies.DedeUserID||'');
    if(mid===OWNER_UID)throw fail('BILI_INDEPENDENT_ACCOUNT_REQUIRED','扫到了主人的账号，请切换为大肥鱼的独立账号后重新扫码');
    if(!mid||!cookies.SESSDATA||!cookies.bili_jct)throw fail('BILI_LOGIN_INCOMPLETE','平台未提供完整登录态');
    writeJson(this.credentialFile,{mid,cookies,createdAt:new Date(this.clock()).toISOString()});
    try{const status=await this.status();writeJson(this.configFile,{...this.config(),ownerUid:OWNER_UID,accountUid:mid,accountName:status.name});return status;}
    catch(error){fs.unlinkSync(this.credentialFile);throw error;}
  }
}
export const accountAuth=new BiliAuth();
