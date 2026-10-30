import type { Conversation, ToolStage } from '@dafeiyu/contracts';

/** Available resources authorize a stage; the task goal determines whether to enter it. */
export function readingStage(goal:string,resources:readonly Conversation[],declared?:ToolStage):ToolStage {
  if(declared)return declared;
  if(!resources.some(resource=>resource.channel==='bilibili'))return 'general';
  if(/开发|修复|修改|部署|插件|脚本|编程|代码|implement|debug|deploy/i.test(goal))return 'general';
  if(/B站|哔哩哔哩|bilibili|\bBV[1-9A-HJ-NP-Za-km-z]{10}\b/i.test(goal))return 'bili-reading';
  return /视频|评论|字幕|弹幕/.test(goal)&&/看|刷|搜|找|读|浏览|推荐|对比|分析/.test(goal)?'bili-reading':'general';
}
