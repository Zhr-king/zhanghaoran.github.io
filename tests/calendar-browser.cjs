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
  let writeCount=0,failRead=false,loseResponse=false,holdWrite=false,releaseWrite;
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
      if(holdWrite){holdWrite=false;await new Promise(resolve=>{releaseWrite=resolve;});}
      return Response.json(item);
    }
    throw new Error('Unexpected Calendar operation');
  });
  let oauthFailure=true;
  const oauth={
    configured:true,
    begin(session){delete session.authError;session.oauth={state:'test-state',expires:Date.now()+60000};return 'http://127.0.0.1:'+server.address().port+'/api/calendar/oauth/callback?state=test-state&code=fixture';},
    async finish(session,params){assert.equal(session.oauth.state,params.get('state'));delete session.oauth;if(oauthFailure)throw new CalendarError('GOOGLE_AUTH_NETWORK_FAILED',502);session.tokens={access_token:'fixture-only'};session.user={id:'browser-user',email:'test@example.test'};delete session.oauth;delete session.authError;}
  };
  const networkState={mode:'auto',state:'idle',kind:'',source:''};
  const transport={status:()=>networkState,close:async()=>{}};
  let externalOpens=0;
  const authorizationPages=[];
  const server=createApp({root,dataDirectory:directory},{oauth,transport,calendarFor:()=>calendar,service:new CalendarService(new Journal(directory)),openBrowser:async url=>{
    externalOpens++;
    const response=await fetch(url,{redirect:'manual'}); // Separate browser: no initiating cookie.
    assert.equal(response.status,200);
    authorizationPages.push(await response.text());
    return true;
  }});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-planner-'));
  const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--lang=zh-CN', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
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
    const pointerClick=async id=>{
      const point=await evaluate('(()=>{const el=document.getElementById('+JSON.stringify(id)+');el.scrollIntoView({block:"center",behavior:"instant"});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    };
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
      if(language==='en') assert.doesNotMatch(await evaluate('document.body.innerText'), /[\u3400-\u9fff]/, 'English interface contains no Chinese');
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
    assert.equal(await evaluate('document.getElementById("taskCalendarNetworkCheck")'),null,'No network scan button');
    assert.match(await evaluate('document.getElementById("taskCalendarNetwork").textContent'),/system network|系统网络/);
    await evaluate('document.querySelector("[data-guide-action=skip]")?.click(); document.getElementById("taskCalendarStartDisplay").scrollIntoView({block:"center"})');
    // Empty details and unrecognized natural language must never produce guessed
    // dates/durations or reach the Calendar API. The list updates as fields are filled.
    assert.equal(await evaluate('document.getElementById("taskDuration").value'),'');
    assert.equal(await evaluate('document.getElementById("taskDeadline").value'),'');
    await pointerClick('saveTask');
    assert.equal(await evaluate('document.querySelectorAll("#taskSubmitFeedback li").length'),4);
    assert.equal(writeCount,2);
    await evaluate('document.getElementById("naturalTask").value="Write a report";document.getElementById("captureForm").requestSubmit()');
    assert.equal(await evaluate('document.getElementById("taskTitle").value'),'Write a report');
    for(const id of ['taskDuration','taskDeadline','taskCalendarStart'])assert.equal(await evaluate('document.getElementById('+JSON.stringify(id)+').value'),'');
    assert.equal(await evaluate('document.querySelectorAll("#taskSubmitFeedback li").length'),3);
    await pointerClick('saveTask');
    assert.equal(writeCount,2,'Missing details must block Google writes');
    assert.equal(await evaluate('document.getElementById("calendarSuccess").hidden'),true);
    await evaluate('document.querySelector("#taskSubmitFeedback button").click()');
    assert.equal(await evaluate('document.activeElement.id'),'taskDuration','Missing-field links focus the correct control');
    await evaluate('document.getElementById("taskDuration").value="120";document.getElementById("taskDuration").dispatchEvent(new Event("input",{bubbles:true}))');
    assert.equal(await evaluate('document.querySelectorAll("#taskSubmitFeedback li").length'),2);
    await evaluate('document.getElementById("taskDeadline").value='+JSON.stringify(key(tomorrow)+'T17:00')+';document.getElementById("taskDeadline").dispatchEvent(new Event("input",{bubbles:true}))');
    assert.equal(await evaluate('document.querySelectorAll("#taskSubmitFeedback li").length'),1);
    await click('languageToggle');
    assert.match(await evaluate('document.getElementById("taskSubmitFeedback").textContent'),/日程开始日期和时间/);
    await click('languageToggle');
    assert.doesNotMatch(await evaluate('document.getElementById("taskSubmitFeedback").textContent'),/[\u3400-\u9fff]/);
    await evaluate('document.getElementById("taskCalendarStart").value='+JSON.stringify(key(tomorrow)+'T14:00')+';document.getElementById("taskCalendarStart").dispatchEvent(new Event("input",{bubbles:true}))');
    assert.equal(await evaluate('document.getElementById("taskSubmitFeedback").hidden'),true);
    assert.equal(writeCount,2,'Completing the details still requires a submit action');
    await evaluate('document.getElementById("taskForm").reset()');
    // Browser-native dates may use Chinese even when the page is English.
    // Our visible fields and popup must follow the page and preserve ISO values.
    assert.equal(await evaluate('document.getElementById("taskCalendarStartDisplay").placeholder'),'YYYY-MM-DD HH:mm');
    const openDate=()=>evaluate('document.getElementById("taskCalendarStartDisplay").parentElement.querySelector("button").click()');
    await openDate();
    assert.doesNotMatch(await evaluate('document.getElementById("forgeDatePicker").innerText'),/[\u3400-\u9fff]/);
    await click('languageToggle');
    assert.match(await evaluate('document.getElementById("forgeDatePicker").innerText'),/小时/);
    assert.match(await evaluate('document.getElementById("taskCalendarStartDisplay").placeholder'),/年/);
    await click('languageToggle');
    assert.doesNotMatch(await evaluate('document.getElementById("forgeDatePicker").innerText'),/[\u3400-\u9fff]/);
    for(const width of [320,1440]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
      await evaluate('window.dispatchEvent(new Event("resize"))');
      assert.equal(await evaluate('(()=>{const r=document.getElementById("forgeDatePicker").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})()'),true,'Picker fits the viewport');
    }
    await evaluate('document.getElementById("taskCalendarStartDisplay").scrollIntoView({block:"center"}); window.dispatchEvent(new Event("resize"))');
    const dateScreenshot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(profile,'date-picker.png'),Buffer.from(dateScreenshot.data,'base64'));
    console.log('Date picker screenshot: '+path.join(profile,'date-picker.png'));
    await evaluate('document.querySelector(".forge-date-day[aria-pressed=true]").click(); for(const [part,value] of [["hour","9"],["minute","30"]]){const el=document.querySelector("[data-time-part="+part+"]");el.value=value;el.dispatchEvent(new Event("input"));} document.querySelector(".forge-date-done").click()');
    assert.equal(await evaluate('document.getElementById("taskCalendarStart").value'),key(today)+'T09:30');
    assert.equal(await evaluate('document.getElementById("taskCalendarStartDisplay").value'),key(today)+' 09:30');
    await evaluate('(()=>{const el=document.getElementById("taskCalendarStartDisplay");el.value="2026-02-30 09:00";el.dispatchEvent(new Event("input"));})()');
    assert.equal(await evaluate('document.getElementById("taskCalendarStartDisplay").checkValidity()'),false);
    assert.equal(await evaluate('document.getElementById("taskCalendarStart").value'),'');
    await evaluate('document.getElementById("taskCalendarStart").value='+JSON.stringify(key(tomorrow)+'T10:15'));
    assert.equal(await evaluate('document.getElementById("taskCalendarStartDisplay").value'),key(tomorrow)+' 10:15','Programmatic task drafts update visible fields');
    await evaluate('document.getElementById("taskForm").reset()');
    assert.equal(await evaluate('document.getElementById("taskCalendarStart").value'),'','Reset clears the canonical value');
    assert.equal(await evaluate('document.getElementById("taskCalendarStartDisplay").value'),'','Reset clears the visible value');
    const fillTask=async(title,start)=>evaluate('Object.entries('+JSON.stringify({taskTitle:title,taskDuration:'60',taskDeadline:key(tomorrow)+'T23:00',taskCalendarStart:local(start),taskCalendarLocation:'Task room',taskCalendarDescription:'Task notes'})+').forEach(([id,value])=>document.getElementById(id).value=value)');
    await fillTask('Main page capture',meetingStart);
    await click('languageToggle');
    assert.equal(await evaluate('document.documentElement.lang'),'zh-CN');
    await click('taskCalendarConnect');
    await until('document.getElementById("taskCalendarDisconnect") && !document.getElementById("taskCalendarDisconnect").hidden');
    assert.equal(await evaluate('location.pathname'),'/planner/','OAuth returns to main Schedule');
    assert.equal(await evaluate('document.getElementById("taskTitle").value'),'Main page capture','OAuth preserves the draft');
    // Reproduce the reported click: 17:11 + 120 minutes exceeds a 17:00 deadline.
    // The message must be visible at the button, even when the page header is offscreen.
    await click('languageToggle');
    await evaluate('Object.entries('+JSON.stringify({taskDuration:'120',taskDeadline:key(tomorrow)+'T17:00',taskCalendarStart:key(tomorrow)+'T17:11'})+').forEach(([id,value])=>document.getElementById(id).value=value)');
    await pointerClick('saveTask');
    assert.equal(writeCount,2,'An invalid time range must not write to Google');
    assert.match(await evaluate('document.getElementById("taskSubmitFeedback").textContent'),/19:11.*after the deadline.*17:00/);
    assert.equal(await evaluate('document.getElementById("taskCalendarStartDisplay").getAttribute("aria-invalid")'),'true');
    assert.equal(await evaluate('(()=>{const el=document.getElementById("taskSubmitFeedback"),r=el.getBoundingClientRect();return !el.hidden&&r.top>=0&&r.bottom<=innerHeight;})()'),true,'Validation is visible at the form');
    const validationScreenshot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(profile,'task-validation.png'),Buffer.from(validationScreenshot.data,'base64'));
    console.log('Task validation screenshot: '+path.join(profile,'task-validation.png'));
    await click('languageToggle');
    assert.match(await evaluate('document.getElementById("taskSubmitFeedback").textContent'),/晚于截止时间/);
    await click('languageToggle');
    assert.doesNotMatch(await evaluate('document.getElementById("taskSubmitFeedback").textContent'),/[\u3400-\u9fff]/);
    // Native validation can prevent submit entirely; it still needs an inline message.
    await evaluate('document.getElementById("taskCalendarStart").value=""');
    await pointerClick('saveTask');
    assert.match(await evaluate('document.getElementById("taskSubmitFeedback").textContent'),/Calendar start date and time/);
    assert.equal(writeCount,2);
    await evaluate('document.getElementById("taskCalendarStartDisplay").focus();document.getElementById("taskCalendarStartDisplay").select()');
    await send('Input.insertText',{text:key(tomorrow)+' 14:00'});
    assert.equal(await evaluate('document.getElementById("taskCalendarStart").value'),key(tomorrow)+'T14:00');
    assert.equal(await evaluate('document.getElementById("taskSubmitFeedback").hidden'),true,'Editing clears the outdated error');
    assert.equal(await evaluate('document.getElementById("taskForm").checkValidity()'),true);
    await fillTask('Main page capture',meetingStart);
    await evaluate('document.getElementById("taskForm").requestSubmit();document.getElementById("taskForm").requestSubmit()');
    await until('!document.getElementById("taskFields").disabled && document.querySelector(".task-google-status")');
    assert.equal(writeCount,3,'Main page double submission creates one Google event');
    assert.equal(remoteEvents.work.at(-1).colorId,'11');
    assert.equal(remoteEvents.work.at(-1).location,'Task room');
    assert.equal(remoteEvents.work.at(-1).description.startsWith('Task notes'),true);
    assert.equal(await evaluate('document.querySelectorAll(".schedule-block.google-overlap").length'),1);
    assert.match(await evaluate('document.getElementById("taskSubmitFeedback").textContent'),/Added to Google Calendar/);
    assert.equal(await evaluate('document.getElementById("taskSubmitFeedback").classList.contains("error")'),false);
    assert.equal(await evaluate('document.getElementById("calendarSuccess").hidden'),false);
    assert.equal(await evaluate('document.getElementById("calendarSuccessTitle").textContent'),'Main page capture');
    assert.equal(await evaluate('document.getElementById("calendarSuccessLink").href'),'https://calendar.google.com/calendar/event?eid=test');
    assert.match(await evaluate('document.getElementById("calendarSuccessTime").textContent'),/09:00.*10:00/);
    assert.match(await evaluate('document.getElementById("calendarSuccessWarning").textContent'),/marked red/);
    await click('languageToggle');
    assert.match(await evaluate('document.getElementById("calendarSuccess").textContent'),/已成功添加到 Google 日历/);
    await click('languageToggle');
    assert.doesNotMatch(await evaluate('document.getElementById("calendarSuccess").textContent'),/[\u3400-\u9fff]/);
    await click('calendarSuccessClose');
    assert.equal(await evaluate('document.getElementById("calendarSuccess").hidden'),true);
    const syncedStart=await evaluate('JSON.parse(localStorage.getItem("forgeos:planner:v1")).tasks[0].googleEvent.start');
    failRead=true;await fillTask('Retry from main page',later);await click('saveTask');
    await until('!document.getElementById("taskFields").disabled && document.getElementById("taskCalendarFeedback").classList.contains("error")');
    assert.equal(writeCount,3);
    assert.equal(await evaluate('document.getElementById("taskTitle").value'),'Retry from main page');
    assert.equal(await evaluate('document.getElementById("taskSubmitFeedback").textContent'),await evaluate('document.getElementById("taskCalendarFeedback").textContent'),'The API failure reason appears beside the submit button');
    assert.equal(await evaluate('document.getElementById("calendarSuccess").hidden'),true,'Failed writes never show success');
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
    assert.equal(await evaluate('document.getElementById("calendarSuccess").hidden'),true,'Local-only tasks never claim a Google write');
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("forgeos:planner:v1")).tasks.length'),4);
    await click('generatePlan');
    assert.equal(await evaluate('document.getElementById("proposalContent").textContent.includes("Main page capture")'),false,'Google entries are not proposed for rescheduling');
    await click('confirmPlan');
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("forgeos:planner:v1")).tasks[0].googleEvent.start'),syncedStart);
    assert.equal(writeCount,5);
    // Correct the user's example to 14:00–16:00, and exercise an actual click and
    // a pending API request so progress, success and the submitted times are checked.
    await fillTask('Corrected report example',later);
    await evaluate('Object.entries('+JSON.stringify({taskDuration:'120',taskDeadline:key(tomorrow)+'T17:00',taskCalendarStart:key(tomorrow)+'T14:00'})+').forEach(([id,value])=>document.getElementById(id).value=value)');
    holdWrite=true;
    await pointerClick('saveTask');
    for(let i=0;i<100&&!releaseWrite;i++)await sleep(20);
    assert.equal(typeof releaseWrite,'function');
    assert.equal(await evaluate('document.getElementById("saveTask").matches(":disabled")'),true);
    assert.match(await evaluate('document.getElementById("taskSubmitFeedback").textContent'),/Adding your task and syncing/);
    assert.equal(await evaluate('document.getElementById("calendarSuccess").hidden'),true,'Pending writes never show success');
    releaseWrite();
    await until('!document.getElementById("taskFields").disabled && document.querySelectorAll(".task-google-status").length===4');
    assert.equal(writeCount,6);
    const exampleStart=new Date(tomorrow);exampleStart.setHours(14);
    assert.equal(remoteEvents.work.at(-1).start.dateTime,exampleStart.toISOString());
    assert.equal(remoteEvents.work.at(-1).end.dateTime,new Date(exampleStart.getTime()+120*60000).toISOString());
    assert.match(await evaluate('document.getElementById("taskSubmitFeedback").textContent'),/Added to Google Calendar/);
    assert.equal(await evaluate('document.querySelectorAll("#calendarSuccess:not([hidden])").length'),1,'Only one success notice is shown');
    assert.equal(await evaluate('document.getElementById("calendarSuccessTitle").textContent'),'Corrected report example');
    for(const language of ['zh-CN','en']){
      if(await evaluate('document.documentElement.lang')!==language)await click('languageToggle');
      if(language==='en') assert.doesNotMatch(await evaluate('document.body.innerText'), /[\u3400-\u9fff]/, 'English interface contains no Chinese');
      for(const theme of ['dark','light']){
        await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme));
        for(const width of [320,375,768,1440]){
          await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
          assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false,'Main Schedule '+language+'/'+theme+'/'+width);
          assert.equal(await evaluate('(()=>{const r=document.getElementById("calendarSuccess").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;})()'),true,'Success notice fits the viewport');
        }
      }
    }
    const mainScreenshot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(profile,'schedule-capture.png'),Buffer.from(mainScreenshot.data,'base64'));
    console.log('Main Schedule screenshot: '+path.join(profile,'schedule-capture.png'));
    assert.equal(externalOpens,3,'Both pages authorize through a separate browser and update automatically');
    for (const html of authorizationPages.slice(0,2)) {
      assert.match(html, /<html lang="en">/);
      assert.doesNotMatch(html, /[\u3400-\u9fff]/, 'English success and failure pages contain no Chinese');
    }
    assert.match(authorizationPages[2], /<html lang="zh-CN">/);
    assert.match(authorizationPages[2], /Google 日历已连接/);
    assert.doesNotMatch(authorizationPages[2], /Return to ForgeOS/);
    assert.deepEqual(errors,[]);
    console.log('PASS: local OAuth/HTTP, calendar capture, overlap allowed/red Google event, double submit, nonoverlap, failed read, drafts, both languages/themes, responsive layouts and disconnect.');
  } finally { if(socket)socket.close();browser.kill();server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
