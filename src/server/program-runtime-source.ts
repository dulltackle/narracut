/** Root、Composition、权威 Speech 与检查入口均来自应用，项目只能提供视觉子树。 */
export const PROGRAM_RUNTIME_SOURCE = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Composition, registerRoot, Sequence, Audio, useCurrentFrame} from 'remotion';
import {Player} from '@remotion/player';
import {RenderProgram} from '../program/src/RenderProgram';
import {bindAssets} from './safe-jsx';
function freeze(value) { if(value && typeof value==='object') {Object.values(value).forEach(freeze);Object.freeze(value);} return value; }
let committed=false, player=null, bridge=null, frame=0, buffering=false, pending=null, frameSequence=0,playing=false;
function emit(type,extra={}) {if(bridge)parent.postMessage({version:1,instanceId:bridge.instanceId,token:bridge.token,type,...extra},bridge.parentOrigin);}
function reportFrame(){
  const current=frame,seq=++frameSequence;
  // 媒体 effect 已同步目标时间；解码未完成时不能声明精确帧已就绪。
  // 使用任务队列，保持视口外 Preview 和隐藏槽位也能完成初始化。
  function ready(){
    if(seq!==frameSequence||!bridge)return;
    if(buffering||(!playing&&Array.from(document.querySelectorAll('video')).some(video=>video.seeking||video.readyState<2))){setTimeout(ready,10);return;}
    const requestId=pending?.frame===current?pending.id:undefined;if(requestId)pending=null;emit('FRAME',{frame:current,requestId});
  }
  setTimeout(ready,0);
}
function FrameCommit(){const current=useCurrentFrame();React.useEffect(()=>{frame=current;reportFrame();},[current]);return null;}
function attachPlayer(ref){player=ref;if(!ref)return;for(const [event,type] of [['play','PLAYING'],['pause','PAUSED'],['ended','PAUSED']])ref.addEventListener(event,()=>{playing=type==='PLAYING';emit(type);});ref.addEventListener('volumechange',e=>emit('VOLUME',{volume:e.detail.volume}));ref.addEventListener('mutechange',e=>emit('MUTE',{muted:e.detail.isMuted}));ref.addEventListener('waiting',()=>{buffering=true;emit('BUFFERING',{buffering:true});});ref.addEventListener('resume',()=>{buffering=false;emit('BUFFERING',{buffering:false});reportFrame();});}
function Visual({input}) { const visual=RenderProgram(input); React.useLayoutEffect(()=>{committed=true;},[]); return visual; }
function Video({input,speech}) { return <><Visual input={input}/><FrameCommit/>{speech.map(s=><Sequence key={s.sceneId} from={s.startFrame} durationInFrames={s.durationInFrames} layout="none"><Audio src={s.src}/></Sequence>)}</>; }
let binding;
function Root() { if(!binding || binding.input.scenes.length===0) return null; const {input,speech}=binding; return <Composition id="Narracut" component={Video} width={input.output.width} height={input.output.height} fps={input.output.fps} durationInFrames={input.durationInFrames} defaultProps={{input,speech}}/>; }
registerRoot(Root);
class Boundary extends React.Component { componentDidCatch(){window.__narracutCheck={code:'RUNTIME_FRAME_FAILED'};emit('ERROR',{code:'RUNTIME_FRAME_FAILED'});} render(){return this.props.children;} }
Object.defineProperty(window,'__narracutBind',{configurable:true,value:(input,speech)=>{
  if(binding) throw new Error('Runtime 只允许绑定一次');
  if(typeof RenderProgram!=='function') throw new Error('RUNTIME_ENTRY_INVALID');
  binding=freeze(JSON.parse(JSON.stringify({input,speech})));
  const frozen=binding.input;
  bindAssets(frozen.assets.filter(asset=>asset.availability==='available').map(asset=>asset.src));
  const metadata={id:'Narracut',...frozen.output,durationInFrames:frozen.durationInFrames,sceneCount:frozen.scenes.length};
  if(frozen.scenes.length===0){ window.__narracutCheck={metadata,runtime:'not-applicable'};return; }
  const composition=Root();
  if(composition.type!==Composition || composition.props.durationInFrames!==frozen.durationInFrames)throw new Error('COMPOSITION_INVALID');
  const root=createRoot(document.getElementById('root'));
  root.render(<Boundary><Player ref={attachPlayer} style={{width:"100%",height:"100%"}} component={Video} inputProps={binding} compositionWidth={frozen.output.width} compositionHeight={frozen.output.height} fps={frozen.output.fps} durationInFrames={frozen.durationInFrames} controls={false} autoPlay={false} initialFrame={0} errorFallback={()=>{window.__narracutCheck={code:'RUNTIME_FRAME_FAILED'};emit('ERROR',{code:'RUNTIME_FRAME_FAILED'});return null;}}/></Boundary>);
  function ready(){if(window.__narracutCheck)return;if(committed)window.__narracutCheck={metadata,runtime:'passed'};else setTimeout(ready,10);}setTimeout(ready,10);
}});
window.addEventListener('narracut-preview-binding',event=>{
  if(bridge||binding)return;
  const prepared=freeze(event.detail);let initialized=false,closed=false;
  function fail(code){emit('ERROR',{code});closed=true;player?.pause();document.getElementById('root').replaceChildren();}
  bridge=prepared;
  window.addEventListener('message',event=>{
    const m=event.data;
    if(closed||event.source!==parent||event.origin!==prepared.parentOrigin||!m||m.instanceId!==prepared.instanceId||m.token!==prepared.token)return;
    if(m.version!==1){fail('BRIDGE_VERSION_UNSUPPORTED');return;}
    if(m.type==='INIT'){
      if(initialized){fail('BRIDGE_ALREADY_BOUND');return;}
      if(JSON.stringify(m.identity)!==JSON.stringify(prepared.identity)){fail('BRIDGE_IDENTITY_MISMATCH');return;}
      initialized=true;
      try{window.__narracutBind(prepared.input,prepared.speech);delete window.__narracutBind;}catch{fail('BRIDGE_INIT_FAILED');return;}
      function ready(){if(closed)return;if(window.__narracutCheck?.code){fail(window.__narracutCheck.code);return;}if(window.__narracutCheck){emit('READY',{identity:prepared.identity});if(prepared.input.scenes.length)reportFrame();}else setTimeout(ready,10);}setTimeout(ready,10);
      return;
    }
    if(!initialized||!player)return;
    if(m.type==='PLAY')player.play();
    else if(m.type==='PAUSE')player.pause();
    else if(m.type==='SEEK'&&Number.isSafeInteger(m.frame)&&m.frame>=0&&m.frame<prepared.input.durationInFrames&&typeof m.requestId==='string'){
      player.pause();pending={frame:m.frame,id:m.requestId};player.seekTo(m.frame);if(frame===m.frame)reportFrame();
    }else if(m.type==='VOLUME'&&Number.isFinite(m.volume)&&m.volume>=0&&m.volume<=1)player.setVolume(m.volume);
    else if(m.type==='MUTE'&&typeof m.muted==='boolean')m.muted?player.mute():player.unmute();
    else fail('BRIDGE_COMMAND_INVALID');
  });
  window.addEventListener('error',()=>fail('RUNTIME_FRAME_FAILED'));
  emit('BOOT');
},{once:true});

`;
export const PROGRAM_ENTRY_CONTRACT = `
import type {ReactNode} from 'react';
import type {RenderProgramInputV1} from '@narracut/runtime';
import {RenderProgram} from '../program/src/RenderProgram';
const entry: (input: RenderProgramInputV1) => ReactNode = RenderProgram;
void entry;
`;

export const PROGRAM_SAFE_JSX = `
import {jsx as original, jsxs as originals, Fragment} from 'react/jsx-runtime';
export {Fragment};
let sources;
export function bindAssets(values){if(sources)throw new Error('重复媒体绑定');sources=new Set(values);}
const tags=new Set('div span p h1 h2 h3 h4 h5 h6 section article header footer main strong em b i small br hr ul ol li svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask use img'.split(' '));
export function check(type,props){
  if(typeof type==='string'&&!tags.has(type))throw new Error('STATIC_FORBIDDEN_CAPABILITY');
  for(const [key,value] of Object.entries(props||{})){
    if(/^on/i.test(key)||['ref','dangerouslySetInnerHTML','srcDoc','innerHTML'].includes(key))throw new Error('STATIC_FORBIDDEN_CAPABILITY');
    if(key==='style')for(const [name,text] of Object.entries(value||{}))if(/animation|transition/i.test(name)||/url\\s*\\(|@import|expression\\s*\\(/i.test(String(text)))throw new Error('STATIC_NONDETERMINISTIC_API');
    if(['href','src','xlinkHref'].includes(key)&&typeof value==='string'&&!value.startsWith('#')&&!sources?.has(value))throw new Error('STATIC_FORBIDDEN_CAPABILITY');
  }
}
export function jsx(type,props,key){check(type,props);return original(type,props,key);}
export function jsxs(type,props,key){check(type,props);return originals(type,props,key);}
`;
export const PROGRAM_SAFE_REMOTION = `
export {interpolate,interpolateColors,spring,Easing,useCurrentFrame} from 'remotion';
import React from 'react';
import {AbsoluteFill as Fill,Sequence as Seq,Series as Ser,Img as Image,Html5Video as Video} from 'remotion';
import {check} from './safe-jsx';
function component(Type){return function SafeComponent(props){check(Type,props);return React.createElement(Type,props);};}
export const AbsoluteFill=component(Fill),Sequence=component(Seq),Img=component(Image);
// 视频仅提供画面，Speech 仍是唯一权威音轨。
export function Html5Video(props){check(Video,props);return React.createElement(Video,{...props,muted:true,volume:0,controls:false,autoPlay:false,disablePictureInPicture:true,disableRemotePlayback:true,pauseWhenBuffering:true});}
export const Series=Object.assign(component(Ser),{Sequence:component(Ser.Sequence)});
import {random as original,useVideoConfig as originalConfig} from 'remotion';
export function useVideoConfig(){const {width,height,fps,durationInFrames}=originalConfig();return Object.freeze({width,height,fps,durationInFrames});}
export function random(seed){if(typeof seed!=='string'&&!(typeof seed==='number'&&Number.isFinite(seed)))throw new Error('STATIC_NONDETERMINISTIC_API');return original(seed);}
`;
