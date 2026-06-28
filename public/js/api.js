(function () {
  'use strict';

  // Resolve API base from the injected <base href> the proxy provides.
  // Falls back to '' when accessed directly (no proxy).
  function getBase() {
    var b = document.querySelector('base');
    var href = b ? b.getAttribute('href') : '';
    if (!href || href === '/') return '';
    return href.replace(/\/$/, '');
  }

  var API_BASE = getBase();

  async function request(path, options) {
    options = options || {};
    var url = (path.startsWith('http') ? path : (API_BASE + '/' + path.replace(/^\/+/, '')));
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var fetchOpts = {
      method: options.method || 'GET',
      credentials: 'include',
      headers: headers
    };
    if (options.body !== undefined) fetchOpts.body = JSON.stringify(options.body);

    var res;
    try {
      res = await fetch(url, fetchOpts);
    } catch (err) {
      window.UI && window.UI.notify('Sin conexión con el servidor', 'error');
      throw err;
    }

    var data = null;
    var text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }

    if (!res.ok) {
      var msg = (data && data.error) || ('Error ' + res.status);
      var err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.API = {
    base: API_BASE,
    get: function (p) { return request(p); },
    post: function (p, b) { return request(p, { method: 'POST', body: b }); },
    put: function (p, b) { return request(p, { method: 'PUT', body: b }); },
    del: function (p) { return request(p, { method: 'DELETE' }); }
  };
})();
