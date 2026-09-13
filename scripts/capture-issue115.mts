/** #115 页面证据：生产工作台资源、协议夹具；不代表真实 Codex 宿主。 */
import { chromium } from '@playwright/test';
import { handleRequest } from '../plugins/narracut/src/server';
import { validResult, installAppToolBridge } from '../tests/helpers/workbench-fixture';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'docs/acceptance/issue115';
await mkdir(output, { recursive:true });
const resource: any = await handleRequest({jsonrpc:'2.0',id:1,method:'resources/read',params:{uri:'ui://narracut/workbench-v1.html'}});
const browser = await chromium.launch();
const measures: unknown[] = [];
try {
  for (const [width,height] of [[902,667],[960,640],[1200,720],[430,860]]) {
    const page = await browser.newPage({viewport:{width,height}});
    const errors: string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.setContent(resource.contents[0].text);
    // tsx 的函数命名辅助器仅用于此采集脚本跨浏览器序列化。
    await page.evaluate('window.__name = fn => fn');
    const fixture=validResult(12);
    fixture.project.folderName='雨后散步与街角的日常记录';
    fixture.videoBrief.content='# 雨后散步\n\n以自然、安静的节奏记录街道。\n\n## 画面与叙事\n\n'+('保持旁白清晰，让街道环境在画面中自然展开。\n\n').repeat(30);
    await installAppToolBridge(page,name=>name==='save_project_video_brief' ? {structuredContent:{status:'brief-conflict',disk:{content:'# 外部修改\n\n保留街道环境的细节。\n',revision:`sha256:${'d'.repeat(64)}`}}} : {structuredContent:{}});
    await page.evaluate(structuredContent=>window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent}},'*'),fixture);
    await page.getByRole('button',{name:/Video Brief/}).waitFor();
    await page.screenshot({path:`${output}/toolbar-${width}.png`});
    const toolbar = await page.getByRole('banner',{name:'项目工具栏'}).boundingBox();
    await page.getByRole('button',{name:/^项目信息：/}).click();
    await page.screenshot({path:`${output}/project-${width}.png`});
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:/Video Brief/}).click();
    await page.screenshot({path:`${output}/brief-${width}.png`});
    const editor=page.getByRole('textbox',{name:'Video Brief 原始 Markdown'});
    await editor.fill('# 本地创作目标\n\n保留自然叙事与街角细节。\n'); await editor.blur();
    await page.getByRole('heading',{name:'外部冲突',exact:true}).waitFor();
    await page.screenshot({path:`${output}/conflict-${width}.png`});
    await page.getByRole('button',{name:'保存合并结果',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:`${output}/conflict-actions-${width}.png`});
    const computed=await page.locator('.brief-layer textarea').first().evaluate(el=>{const css=getComputedStyle(el);return {color:css.color,background:css.backgroundColor,font:css.font,padding:css.padding};});
    measures.push({width,height,toolbar,computed,errors});
    await page.close();
  }
  await writeFile(`${output}/measurements.json`,JSON.stringify(measures,null,2)+'\n');
} finally { await browser.close(); }
