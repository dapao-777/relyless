(() => {
  if (globalThis.__shisuiAutoBootstrap) return;
  globalThis.__shisuiAutoBootstrap = true;

  let lastURL = '';
  let scheduled = false;
  const check = () => {
    scheduled = false;
    if (location.href === lastURL) return;
    lastURL = location.href;
    chrome.runtime.sendMessage({type:'AUTO_BOOTSTRAP_CHECK'}).catch(() => {});
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(check);
  };

  addEventListener('popstate',schedule,{passive:true});
  addEventListener('hashchange',schedule,{passive:true});
  const wrap = method => {
    const original = history[method];
    history[method] = function(...args) {
      const result = original.apply(this,args);
      schedule();
      return result;
    };
  };
  wrap('pushState');
  wrap('replaceState');
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'SS_AUTO_RECHECK') {
      lastURL = '';
      schedule();
    }
  });
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded',schedule,{once:true});
  else schedule();
})();
