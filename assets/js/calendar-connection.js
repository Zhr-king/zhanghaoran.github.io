/* Google authorization uses the system browser; polling stays on localhost. */
(() => {
  'use strict';
  const errors = {
    GOOGLE_NETWORK_UNAVAILABLE: ['向 Google 发送请求失败，请稍后重新连接。', 'The request to Google failed. Please reconnect.'],
    GOOGLE_PROXY_UNAVAILABLE: ['系统配置的代理暂未接受连接，请确认代理已运行后重试。', 'The configured system proxy is not accepting connections. Retry when it is running.'],
    GOOGLE_PROXY_AUTH_REQUIRED: ['系统代理要求身份验证，暂时无法连接 Google。', 'The system proxy requires authentication.'],
    GOOGLE_PROXY_CONFIGURATION_FAILED: ['未能读取系统代理配置，请重试。', 'Could not read the system proxy configuration. Retry.'],
    GOOGLE_REQUEST_TIMEOUT: ['Google 请求超时，请重新连接。', 'The Google request timed out. Reconnect.'],
    GOOGLE_TLS_FAILED: ['Google 安全连接验证失败，未发送后续请求。', 'The secure connection to Google could not be verified.'],
    GOOGLE_AUTH_INVALID_RESPONSE: ['Google 授权返回异常，请重新连接。', 'Google returned an unexpected authorization response. Reconnect.'],
    GOOGLE_PROFILE_FAILED: ['Google 账号信息读取失败，请重新连接。', 'Could not read your Google account information. Reconnect.'],
    AUTH_IN_PROGRESS: ['正在完成 Google 授权，请稍候。', 'Google authorization is in progress. Please wait.']
  };
  const waiting = ['请在系统浏览器中完成 Google 授权，这里会自动更新。', 'Complete Google authorization in your browser. This page will update automatically.'];
  let leaving = false;
  window.addEventListener('pagehide', () => { leaving = true; });
  async function wait(api) {
    const deadline = Date.now() + 10 * 60000;
    while (!leaving && Date.now() < deadline) {
      const current = await api('status');
      if (current.authenticated) return;
      if (current.authError) throw { code: current.authError };
      if (!current.authorizing) throw { code: 'GOOGLE_AUTH_SESSION_EXPIRED' };
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw { code: 'GOOGLE_AUTH_SESSION_EXPIRED' };
  }
  async function start(api, returnTo, onWaiting) {
    const result = await api('auth/start', { returnTo, external: true, language: window.ForgeI18n.language });
    if (!result.opened) { location.assign(result.url); return false; }
    onWaiting();
    await wait(api);
    return true;
  }
  window.ForgeCalendarConnection = { errors, waiting, start, wait };
})();
