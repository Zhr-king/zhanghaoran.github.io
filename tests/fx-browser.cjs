// Browser performance comparison. Run with --baseline to serve the committed effects.
// Keeps every effect enabled; writes measurements to the OS temporary directory.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(url) {
  const socket = new WebSocket(url); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map(), events = [];
  socket.onmessage = ({data}) => { const m = JSON.parse(data); if(m.method){events.push(m);return;} const p = pending.get(m.id); if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result); };
  return {events,close:()=>socket.close(),send:(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error('Timeout '+method));},20000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));})};
}
(async()=>{
  const originals = new Map();
  if(baseline)for(const file of ['assets/js/fx.js','assets/js/ui.js','assets/css/style.css'])originals.set('/'+file,execFileSync('git',['show','HEAD:'+file],{cwd:root}));
  const server=http.createServer((req,res)=>{let p=new URL(req.url,'http://localhost').pathname;if(p==='/')p='/index.html';const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream')+'; charset=utf-8');res.end(originals.get(p)||fs.readFileSync(file));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'forgeos-fx-profile-'));
  const chrome=spawn(process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
  let launchError,cdp,browser;chrome.on('error',e=>launchError=e);
  try{
    const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(portFile)&&!launchError;i++)await sleep(100);if(launchError)throw launchError;
    const [port,browserPath]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
    browser=await connect('ws://127.0.0.1:'+port+browserPath);
    const gpu=await browser.send('SystemInfo.getInfo');
    console.log(JSON.stringify({baseline,gpu:{devices:gpu.gpu.devices,features:gpu.gpu.featureStatus,renderer:gpu.gpu.auxAttributes.glRenderer}},null,2));
    const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();cdp=await connect(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Performance.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1.5,mobile:false});
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`sessionStorage.setItem('forgeos:booted','1'); Math.random=(()=>{let s=12345;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296)})();`});
    await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});await sleep(2200);
    const summaries=[];
    for(const theme of ['dark','light']){
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.scrollTo({top:0,behavior:'instant'});`);await sleep(1800);
      for(const region of ['hero','card']){
        await evaluate(region==='hero'?`window.scrollTo({top:0,behavior:'instant'})`:`document.querySelector('[data-tilt]').scrollIntoView({block:'center',behavior:'instant'});`);await sleep(1000);
        const bounds=await evaluate(region==='hero'?`({x:innerWidth/2-200,y:innerHeight/2-100,width:400,height:200})`:`(()=>{const r=document.querySelector('[data-tilt]').getBoundingClientRect();return{x:r.left+30,y:r.top+30,width:r.width-60,height:r.height-60}})()`);
        await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
        await evaluate(`window.__profileFrames=[];window.__profileStop=false;window.__profileLast=0;requestAnimationFrame(function sample(t){if(window.__profileStop)return;if(window.__profileLast)window.__profileFrames.push(t-window.__profileLast);window.__profileLast=t;requestAnimationFrame(sample)});`);
        const before=await cdp.send('Performance.getMetrics');cdp.events.length=0;
        await cdp.send('Tracing.start',{categories:'devtools.timeline',options:'record-as-much-as-possible'});
        const wall=performance.now();
        for(let i=0;i<110;i++){const a=i/109*Math.PI*4;await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:bounds.x+bounds.width*(.5+.43*Math.cos(a)),y:bounds.y+bounds.height*(.5+.43*Math.sin(a))});await sleep(8);}
        await cdp.send('Tracing.end');for(let i=0;i<100&&!cdp.events.some(e=>e.method==='Tracing.tracingComplete');i++)await sleep(50);
        const elapsed=performance.now()-wall,after=await cdp.send('Performance.getMetrics');
        const frameTimes=await evaluate('window.__profileStop=true;window.__profileFrames');
        const trace=cdp.events.filter(e=>e.method==='Tracing.dataCollected').flatMap(e=>e.params.value);
        const duration=name=>trace.filter(e=>e.name===name&&e.ph==='X').reduce((n,e)=>n+(e.dur||0)/1000,0);
        const diff={};for(const n of ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'])diff[n]=+(after.metrics.find(m=>m.name===n).value-before.metrics.find(m=>m.name===n).value).toFixed(4);
        frameTimes.sort((a,b)=>a-b);
        const summary={theme,region,cpuSlowdown:4,elapsedMs:Math.round(elapsed),samples:frameTimes.length,frameMedianMs:+frameTimes[Math.floor(frameTimes.length*.5)].toFixed(1),frameP95Ms:+frameTimes[Math.floor(frameTimes.length*.95)].toFixed(1),paintMs:+duration('Paint').toFixed(1),styleMs:+duration('UpdateLayoutTree').toFixed(1),metrics:diff};summaries.push(summary);console.log(JSON.stringify(summary));
        fs.writeFileSync(path.join(profile,theme+'-'+region+'.trace.json'),JSON.stringify({traceEvents:trace}));
      }
    }
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
    const errors=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown');if(errors.length)throw new Error(JSON.stringify(errors));
    fs.writeFileSync(path.join(profile,'summary.json'),JSON.stringify(summaries,null,2));console.log('Artifacts: '+profile);
  }finally{cdp?.close();browser?.close();chrome.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
