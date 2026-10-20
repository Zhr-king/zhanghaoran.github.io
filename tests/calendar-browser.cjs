// Run with Node 22+ and Chrome installed. An isolated temporary profile is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {

  const {createApp}=await import('../server/app.mjs');
  const {CalendarService,Journal}=await import('../server/calendar-service.mjs');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'forgeos-calendar-browser-data-'));
  const today=new Date();today.setHours(0,0,0,0);
  const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);
  const key=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const meetingStart=new Date(tomorrow);meetingStart.setHours(9);
  const meetingEnd=new Date(tomorrow);meetingEnd.setHours(11);
  const remoteEvents={work:[
    {id:'all-day',summary:'Today is reserved',start:{date:key(today)},end:{date:key(tomorrow)}},
    {id:'meeting',summary:'Team meeting',start:{dateTime:meetingStart.toISOString()},end:{dateTime:meetingEnd.toISOString()}}
  ],tasks:[]};
  let writeCount=0,failRead=false;
  const mcp={run:async work=>work(async(name,args)=>{
    if(name==='list_calendars')return {calendars:[{id:'work',summary:'Work calendar'},{id:'tasks',summary:'ForgeOS tasks'}]};
    if(name==='list_events'){
      if(failRead)throw new Error('Fixture read unavailable');
      return structuredClone({events:remoteEvents[args.calendarId],accessRole:'writer',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
    }
    if(name==='get_event')return structuredClone(remoteEvents[args.calendarId].find(e=>e.id===args.eventId));
    if(name==='create_event'||name==='update_event'){
      writeCount++;
      const item=name==='create_event'?{id:'task-'+writeCount}:remoteEvents[args.calendarId].find(e=>e.id===args.eventId);
      Object.assign(item,{summary:args.summary,start:{dateTime:args.startTime},end:{dateTime:args.endTime},updated:String(writeCount)});
      if(args.description)item.description=args.description; if(args.colorId)item.colorId=args.colorId; if(args.location)item.location=args.location; item.htmlLink='https://calendar.google.com/calendar/event?eid=test';
      if(name==='create_event')remoteEvents[args.calendarId].push(item);
      return structuredClone(item);
    }
    throw new Error('Unexpected tool '+name);
  })};
  const oauth={
    configured:true,
    begin(session){session.oauth={state:'test-state'};return 'http://127.0.0.1:'+server.address().port+'/api/calendar/oauth/callback?state=test-state&code=fixture';},
    async finish(session,params){assert.equal(session.oauth.state,params.get('state'));session.tokens={access_token:'fixture-only'};session.user={id:'browser-user',email:'test@example.test'};delete session.oauth;}
  };
  const server=createApp({root,dataDirectory:directory},{oauth,mcpFor:()=>mcp,service:new CalendarService(new Journal(directory))});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-planner-'));
  const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let launchError, socket;
  browser.on('error', error => { launchError = error; });
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile) && !launchError; i++) await sleep(100);
    if (launchError) throw launchError;
    assert(fs.existsSync(portFile), 'Chrome did not start');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const pending = new Map(), errors = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(new Error('Timeout: ' + method)); }, 10000);
      pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    await send('Runtime.enable'); await send('Page.enable');
    const base = `http://127.0.0.1:${server.address().port}`;
    const until=async expression=>{for(let i=0;i<150;i++){try {if(await evaluate(expression))return;}catch(e){if(!/context|navigat/i.test(e.message))throw e;}await sleep(50);}throw new Error('Wait failed: '+expression);};
    const click=id=>evaluate('document.getElementById('+JSON.stringify(id)+').click()');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await send('Page.navigate',{url:base+'/planner/calendar.html'});
    await until('document.readyState==="complete" && document.getElementById("connectCalendar") && !document.getElementById("connectCalendar").disabled');
    assert.equal(await evaluate('document.getElementById("eventFields").disabled'),true);
    await click('connectCalendar');
    await until('document.getElementById("eventFields") && !document.getElementById("eventFields").disabled');
    assert.equal(await evaluate('document.querySelectorAll(".calendar-event").length'),2);
    assert.equal(writeCount,0,'Connecting does not create events');
    const local=d=>key(d)+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    const fill=async(title,start,end)=>evaluate('Object.entries('+JSON.stringify({eventTitle:title,eventStart:local(start),eventEnd:local(end),eventDescription:'Bring the report',eventLocation:'Room 2'})+').forEach(([id,value])=>document.getElementById(id).value=value)');
    await fill('Project review',meetingStart,meetingEnd);
    await evaluate('document.getElementById("calendarEventForm").requestSubmit();document.getElementById("calendarEventForm").requestSubmit()');
    await until('!document.getElementById("eventFields").disabled && !document.getElementById("calendarResult").hidden');
    assert.equal(writeCount,1,'Rapid submits are deduplicated');
    assert.equal(remoteEvents.work[2].colorId,'11','Overlapping event is RED IN GOOGLE, not just in local CSS');
    assert.equal(remoteEvents.work[2].location,'Room 2');assert(remoteEvents.work[2].description.startsWith('Bring the report'));
    assert.equal(remoteEvents.work[1].colorId,undefined,'Original Google event unchanged');
    assert.equal(await evaluate('document.getElementById("calendarResult").classList.contains("overlapping")'),true);
    assert.equal(await evaluate('document.querySelectorAll(".calendar-result li").length'),1);
    assert.equal(await evaluate('document.querySelectorAll(".calendar-event.overlapping").length'),2);
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
    const screenshot=await send('Page.captureScreenshot',{format:'png'});
    const screenshotPath=path.join(profile,'calendar-capture.png');fs.writeFileSync(screenshotPath,Buffer.from(screenshot.data,'base64'));console.log('Screenshot: '+screenshotPath);
    const later=new Date(meetingEnd);later.setHours(14);const laterEnd=new Date(later);laterEnd.setHours(15);
    await fill('Solo work',later,laterEnd);await click('createCalendarEvent');
    await until('!document.getElementById("eventFields").disabled && document.getElementById("eventTitle").value===""');
    assert.equal(writeCount,2);assert.equal(remoteEvents.work[3].colorId,undefined,'Nonoverlap keeps default color');
    // Failed reads must not claim there are no overlaps or lose the user's input.
    failRead=true;await fill('Keep my draft',later,laterEnd);await click('createCalendarEvent');
    await until('!document.getElementById("eventFields").disabled && document.getElementById("calendarFeedback").classList.contains("error")');
    assert.equal(writeCount,2);assert.equal(await evaluate('document.getElementById("eventTitle").value'),'Keep my draft');
    failRead=false;await click('readCalendar');await until('!document.getElementById("readCalendar").disabled');
    for(const language of ['zh-CN','en']){
      if(await evaluate('document.documentElement.lang')!==language)await click('languageToggle');
      for(const theme of ['dark','light']){
        await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme));
        for(const width of [320,375,768,1440]){
          await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
          assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false,language+'/'+theme+'/'+width);
        }
      }
    }
    await click('disconnectCalendar');await until('!document.getElementById("connectCalendar").hidden && !document.getElementById("retryCalendar").disabled');
    assert.equal(await evaluate('document.querySelectorAll(".calendar-event").length'),0);assert.equal(remoteEvents.work.length,4,'Disconnect does not delete Google events');
    assert.deepEqual(errors,[]);
    console.log('PASS: local OAuth/HTTP, calendar capture, overlap allowed/red Google event, double submit, nonoverlap, failed read, drafts, both languages/themes, responsive layouts and disconnect.');
  } finally { if(socket)socket.close();browser.kill();server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
