/** Only disambiguates the browser's generic wording heuristic. It never solves a challenge. */
export const contentChallengeCheck=String.raw`(()=>{
 const contentSelector='h1,#v_desc,.basic-desc-info,.video-tag-container,.rec-list,bili-comments,#comment';
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';};
 const roots=[{root:document,content:false}],content=[],outside=[];let widget=false;
 for(let i=0;i<roots.length&&i<100;i++){
  const entry=roots[i],root=entry.root;
  for(const e of root.querySelectorAll('*')){
   if(e.shadowRoot)roots.push({root:e.shadowRoot,content:entry.content||!!e.closest(contentSelector)});
   if(!visible(e))continue;
   if(e.matches('#challenge-running,#challenge-stage,#cf-chl-container,.h-captcha,.g-recaptcha,.cf-turnstile,.geetest_panel,.geetest_widget,.geetest_holder,[class*="captcha" i],[id*="captcha" i]'))widget=true;
   if(e.tagName==='IFRAME'&&/captcha|geetest|challenge|verify|verification/i.test((e.src||'')+' '+(e.title||'')))widget=true;
   if(e.matches('form,[role="dialog"]')&&/验证|captcha|verification|verify.*human/i.test(e.innerText||''))widget=true;
  }
  const walker=document.createTreeWalker(root===document?document.body:root,NodeFilter.SHOW_TEXT);
  let n;while(n=walker.nextNode()){const p=n.parentElement,text=n.textContent?.trim();if(!p||!text||p.closest('script,style,template,noscript')||!visible(p))continue;
   (entry.content||p.closest(contentSelector)?content:outside).push(text);
  }
 }
 const pattern=/验证|captcha|verification|verify.*human|security check|access denied|checking your browser/i;
 const v=document.querySelector('video');
 return {normalVideo:!!document.querySelector('h1')?.innerText?.trim()&&!!v&&v.readyState>=2&&v.videoWidth>0&&Number.isFinite(v.duration)&&v.duration>0,
  widget,outsideVerificationText:pattern.test(outside.join('\n')),contentVerificationText:pattern.test(content.join('\n'))};
})()`;
