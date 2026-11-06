(() => {
  'use strict';
  let status = { available: false, authenticated: false }, refreshing;
  const messages = {
    CODEX_LOCAL_SERVICE: ['请通过 ForgeOS.vbs 或 npm start 启动本地服务，再打开 Schedule。', 'Start the local service with ForgeOS.vbs or npm start, then open Schedule.'],
    CODEX_NOT_INSTALLED: ['未找到 Codex CLI。安装后运行 codex login，再重试连接。', 'Codex CLI was not found. Install it and run codex login, then retry.'],
    CODEX_SIGN_IN_REQUIRED: ['请在本机终端运行 codex login，完成登录后重试。', 'Run codex login in a local terminal, then retry after signing in.'],
    CODEX_TIMEOUT: ['Codex 响应超时，输入已保留，请稍后重试。', 'Codex timed out. Your input is preserved; please retry.'],
    CODEX_BUSY: ['Codex 正在处理另一个请求，请稍后重试。', 'Codex is processing another request. Please retry shortly.'],
    CODEX_LIMIT_REACHED: ['Codex 额度不足或请求过多，请检查账号额度后重试。', 'Codex reached a usage or rate limit. Check your account and retry.'],
    CODEX_UPDATE_REQUIRED: ['请更新 Codex CLI 后重试，此版本不支持所需调用参数。', 'Update Codex CLI and retry; this version does not support the required options.'],
    CODEX_INVALID_BINARY: ['请在服务端配置 Codex 可执行文件或 codex.js 路径。', 'Configure the Codex executable or codex.js path on the server.'],
    CODEX_PROXY_CONFIGURATION_FAILED: ['无法读取 Codex 网络代理设置，请检查本机系统代理后重试。', 'Codex proxy settings could not be resolved. Check the system proxy and retry.'],
    CODEX_INVALID_RESPONSE: ['Codex 返回的信息不完整或格式无效，表单已保留，请重试。', 'Codex returned incomplete or invalid details. Your form is preserved; please retry.'],
    CODEX_INVALID_INPUT: ['请检查任务描述、当前日期和时区。', 'Check the task description, current date, and time zone.'],
    CODEX_FAILED: ['Codex 调用失败。请检查本机登录、网络及 CLI 状态后重试，输入已保留。', 'Codex failed. Check your local login, network, and CLI, then retry. Your input is preserved.']
  };
  const emit = () => document.dispatchEvent(new CustomEvent('forgeos:codexchange'));
  async function request(route, input) {
    let response, result;
    try {
      response = await fetch('/api/codex/' + route, {
        method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: input === undefined ? {} : { 'Content-Type': 'application/json', 'X-ForgeOS-CSRF': status.csrf || '' },
        body: input === undefined ? undefined : JSON.stringify(input), signal: AbortSignal.timeout(route === 'status' ? 15000 : 130000)
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw { code: 'CODEX_LOCAL_SERVICE' };
      result = await response.json();
    } catch (error) { throw { code: error.code || (error.name === 'TimeoutError' ? 'CODEX_TIMEOUT' : 'CODEX_LOCAL_SERVICE') }; }
    if (!response.ok) throw { code: result.error || 'CODEX_FAILED' };
    return result;
  }
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try { status = await request('status'); }
      catch (error) { status = { available: false, authenticated: false, error: error.code }; }
      finally { refreshing = null; emit(); }
      return status;
    })();
    return refreshing;
  }
  async function call(route, input) {
    await refresh();
    if (!status.authenticated) throw { code: status.error || 'CODEX_SIGN_IN_REQUIRED' };
    try {
      const result = await request(route, input);
      status.verifiedAt = result.verifiedAt; status.error = ''; emit(); return result;
    } catch (error) {
      status.verifiedAt = null; status.error = error.code;
      if (error.code === 'CODEX_SIGN_IN_REQUIRED') status.authenticated = false;
      emit(); throw error;
    }
  }
  window.ForgeCodex = {
    get status() { return status; }, refresh,
    test: () => call('test', {}),
    extract: text => {
      const now = new Date(), pad = value => String(value).padStart(2, '0');
      return call('extract', { text, now: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
    },
    errorPair: error => messages[error?.code || error] || messages.CODEX_FAILED
  };
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
  refresh();
})();
