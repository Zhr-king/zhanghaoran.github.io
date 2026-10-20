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
  const {GoogleCalendar}=await import('../server/google-calendar.mjs');
  const {CalendarError}=await import('../server/google-mcp.mjs');
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
  let writeCount=0,failRead=false,loseResponse=false;
  const calendar=new GoogleCalendar(async()=>'fixture-only',async(url,init)=>{
    assert.equal(url.origin,'https://www.googleapis.com');
    assert.equal(init.headers.Authorization,'Bearer fixture-only');
    if(url.pathname.endsWith('/users/me/calendarList'))return Response.json({items:[{id:'work',summary:'Work calendar'},{id:'tasks',summary:'ForgeOS tasks'}]});
    const match=url.pathname.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    assert(match,'Unexpected Calendar endpoint');
    const calendarId=decodeURIComponent(match[1]),eventId=match[2]&&decodeURIComponent(match[2]);
    if(init.method==='GET'&&!eventId){
      if(failRead)throw new Error('Fixture read unavailable');
      assert.equal(url.searchParams.get('singleEvents'),'true');
      return Response.json({items:remoteEvents[calendarId],accessRole:'writer',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
    }
    if(init.method==='GET'&&eventId)return Response.json(remoteEvents[calendarId].find(e=>e.id===eventId));
    if(init.method==='POST'&&!eventId){
      writeCount++;
      const item={...JSON.parse(init.body),id:'task-'+writeCount,htmlLink:'https://calendar.google.com/calendar/event?eid=test'};
      remoteEvents[calendarId].push(item);
      if(loseResponse){loseResponse=false;throw new Error('Response lost after committed write');}
      return Response.json(item);
    }
    throw new Error('Unexpected Calendar operation');
  });
  let oauthFailure=true;
  const oauth={
    configured:true,
    begin(session){delete session.authError;session.oauth={state:'test-state'};return 'http://127.0.0.1:'+server.address().port+'/api/calendar/oauth/callback?state=test-state&code=fixture';},
    async finish(session,params){assert.equal(session.oauth.state,params.get('state'));if(oauthFailure)throw new CalendarError('GOOGLE_AUTH_NETWORK_FAILED',502);session.tokens={access_token:'fixture-only'};session.user={id:'browser-user',email:'test@example.test'};delete session.oauth;delete session.authError;}
  };
  const networkState={mode:'auto',state:'ready',kind:'proxy',endpoint:'127.0.0.1:7993',source:'application'};
  const transport={status:()=>networkState,check:async()=>networkState,close:async()=>{}};
  const server=createApp({root,dataDirectory:directory},{oauth,transport,calendarFor:()=>calendar,service:new CalendarService(new Journal(directory))});
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
    await until('document.getElementById("calendarFeedback")?.classList.contains("error") && !document.getElementById("connectCalendar").disabled');
    assert.match(await evaluate('document.getElementById("calendarFeedback").textContent'),/本地服务无法连接 Google|local service cannot reach Google/);
    assert.equal(await evaluate('new URLSearchParams(location.search).has("calendar")'),false,'Remove stale callback state');
    await click('retryCalendar');
    await until('!document.getElementById("retryCalendar").disabled');
    assert.match(await evaluate('document.getElementById("calendarFeedback").textContent'),/本地服务无法连接 Google|local service cannot reach Google/,'Refreshing retains useful error');
    oauthFailure=false;
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
    // The main Schedule capture form now writes directly to Google Calendar.
    await send('Page.navigate',{url:base+'/planner/'});
    await until('document.getElementById("taskCalendarConnect") && !document.getElementById("taskCalendarConnect").disabled');
    await click('taskCalendarNetworkCheck');
    await until('!document.getElementById("taskCalendarNetworkCheck").disabled');
    assert.match(await evaluate('document.getElementById("taskCalendarNetwork").textContent'),/127\.0\.0\.1:7993/);
    const fillTask=async(title,start)=>evaluate('Object.entries('+JSON.stringify({taskTitle:title,taskDuration:'60',taskDeadline:key(tomorrow)+'T23:00',taskCalendarStart:local(start),taskCalendarLocation:'Task room',taskCalendarDescription:'Task notes'})+').forEach(([id,value])=>document.getElementById(id).value=value)');
    await fillTask('Main page capture',meetingStart);
    await click('taskCalendarConnect');
    await until('document.getElementById("taskCalendarDisconnect") && !document.getElementById("taskCalendarDisconnect").hidden');
    assert.equal(await evaluate('location.pathname'),'/planner/','OAuth returns to main Schedule');
    assert.equal(await evaluate('document.getElementById("taskTitle").value'),'Main page capture','OAuth preserves the draft');
    await evaluate('document.getElementById("taskForm").requestSubmit();document.getElementById("taskForm").requestSubmit()');
    await until('!document.getElementById("taskFields").disabled && document.querySelector(".task-google-status")');
    assert.equal(writeCount,3,'Main page double submission creates one Google event');
    assert.equal(remoteEvents.work.at(-1).colorId,'11');
    assert.equal(remoteEvents.work.at(-1).location,'Task room');
    assert.equal(remoteEvents.work.at(-1).description.startsWith('Task notes'),true);
    assert.equal(await evaluate('document.querySelectorAll(".schedule-block.google-overlap").length'),1);
    const syncedStart=await evaluate('JSON.parse(localStorage.getItem("forgeos:planner:v1")).tasks[0].googleEvent.start');
    failRead=true;await fillTask('Retry from main page',later);await click('saveTask');
    await until('!document.getElementById("taskFields").disabled && document.getElementById("taskCalendarFeedback").classList.contains("error")');
    assert.equal(writeCount,3);
    assert.equal(await evaluate('document.getElementById("taskTitle").value'),'Retry from main page');
    failRead=false;await click('saveTask');
    await until('!document.getElementById("taskFields").disabled && document.querySelectorAll(".task-google-status").length===2');
    assert.equal(writeCount,4);
    loseResponse=true;
    await fillTask('Uncertain main page write',later);
    await click('saveTask');
    await until('!document.getElementById("taskFields").disabled && document.getElementById("taskCalendarFeedback").classList.contains("error")');
    assert.equal(writeCount,5);
    await send('Page.reload');
    await until('document.getElementById("taskCalendarDisconnect") && !document.getElementById("taskCalendarDisconnect").hidden');
    assert.equal(await evaluate('document.getElementById("taskTitle").value'),'Uncertain main page write');
    await click('saveTask');
    await until('!document.getElementById("taskFields").disabled && document.querySelectorAll(".task-google-status").length===3');
    assert.equal(writeCount,5,'Reload retry reconciles an uncertain write without duplication');
    await send('Page.reload');
    await until('document.getElementById("taskCalendarDisconnect") && !document.getElementById("taskCalendarDisconnect").hidden');
    assert.equal(writeCount,5,'Reload does not create events');
    assert.equal(await evaluate('document.querySelectorAll(".task-google-status").length'),3);
    await fillTask('Local only task',later);
    await click('taskCalendarSync');await click('saveTask');
    assert.equal(writeCount,5,'Explicit local-only entry stays local');
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("forgeos:planner:v1")).tasks.length'),4);
    await click('generatePlan');
    assert.equal(await evaluate('document.getElementById("proposalContent").textContent.includes("Main page capture")'),false,'Google entries are not proposed for rescheduling');
    await click('confirmPlan');
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("forgeos:planner:v1")).tasks[0].googleEvent.start'),syncedStart);
    assert.equal(writeCount,5);
    for(const language of ['zh-CN','en']){
      if(await evaluate('document.documentElement.lang')!==language)await click('languageToggle');
      for(const theme of ['dark','light']){
        await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme));
        for(const width of [320,375,768,1440]){
          await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
          assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false,'Main Schedule '+language+'/'+theme+'/'+width);
        }
      }
    }
    const mainScreenshot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(profile,'schedule-capture.png'),Buffer.from(mainScreenshot.data,'base64'));
    console.log('Main Schedule screenshot: '+path.join(profile,'schedule-capture.png'));
    assert.deepEqual(errors,[]);
    console.log('PASS: local OAuth/HTTP, calendar capture, overlap allowed/red Google event, double submit, nonoverlap, failed read, drafts, both languages/themes, responsive layouts and disconnect.');
  } finally { if(socket)socket.close();browser.kill();server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
