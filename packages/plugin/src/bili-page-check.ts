/** Only disambiguates the browser's generic wording heuristic. It never solves a challenge. */
export const contentChallengeCheck=String.raw`(()=>{
 const contentSelector='h1,#v_desc,.basic-desc-info,.video-tag-container,.rec-list,bili-comments,#comment';
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';};
 const inContent=e=>{if(e.closest(contentSelector))return true;const a=e.closest('a[href]');if(!a)return false;try{const u=new URL(a.href);return u.hostname==='www.bilibili.com'&&/^\/video\/BV[0-9A-Za-z]{10}\/?$/.test(u.pathname);}catch{return false;}};
 const roots=[{root:document,content:false}],content=[],outside=[];let widget=false;
 for(let i=0;i<roots.length&&i<100;i++){
  const entry=roots[i],root=entry.root;
  for(const e of root.querySelectorAll('*')){
   if(e.shadowRoot)roots.push({root:e.shadowRoot,content:entry.content||inContent(e)});
   if(!visible(e))continue;
   if(e.matches('#challenge-running,#challenge-stage,#cf-chl-container,.h-captcha,.g-recaptcha,.cf-turnstile,.geetest_panel,.geetest_widget,.geetest_holder,[class*="captcha" i],[id*="captcha" i]'))widget=true;
   if(e.tagName==='IFRAME'&&/captcha|geetest|challenge|verify|verification/i.test((e.src||'')+' '+(e.title||'')))widget=true;
   if(e.matches('form,[role="dialog"]')&&/验证|captcha|verification|verify.*human/i.test(e.innerText||''))widget=true;
  }
  const walker=document.createTreeWalker(root===document?document.body:root,NodeFilter.SHOW_TEXT);
  let n;while(n=walker.nextNode()){const p=n.parentElement,text=n.textContent?.trim();if(!p||!text||p.closest('script,style,template,noscript')||!visible(p))continue;
   (entry.content||inContent(p)?content:outside).push(text);
  }
 }
 const pattern=/验证|captcha|verification|verify.*human|security check|access denied|checking your browser/i;
 const blockingText=/(?:请|必须|需要|完成).{0,12}(?:人机验证|安全验证|滑块验证)|验证.{0,12}(?:继续访问|继续播放)|verify.{0,12}(?:human|not a robot)|checking your browser|access denied|(?:^|\n)\s*(?:安全验证|人机验证|security check)\s*(?:\n|$)/i;
 const v=document.querySelector('video');
 return {normalVideo:!!document.querySelector('h1')?.innerText?.trim()&&!!v&&v.readyState>=2&&v.videoWidth>0&&Number.isFinite(v.duration)&&v.duration>0,
  widget,outsideVerificationText:blockingText.test(outside.join('\n')),contentVerificationText:pattern.test(content.join('\n'))};
})()`;
