(function () {
  'use strict';

  var routes = {};
  var currentCleanup = null;

  function register(name, renderFn) {
    routes[name] = renderFn;
  }

  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    if (!h) return { name: 'landing', params: {} };
    var parts = h.split('/');
    var name = parts[0];
    var params = {};
    if (parts[1]) params.id = parts[1];
    return { name: name, params: params };
  }

  function navigate(path) {
    if (location.hash === '#/' + path) {
      handleRoute();
    } else {
      location.hash = '#/' + path;
    }
  }

  async function handleRoute() {
    var route = parseHash();
    var user = window.Auth.getUser();

    // Auth guards
    var publicRoutes = ['landing', 'login', 'register'];
    if (!user && !publicRoutes.includes(route.name)) {
      navigate('login');
      return;
    }
    if (user && (route.name === 'login' || route.name === 'register' || route.name === 'landing')) {
      navigate('dashboard');
      return;
    }
    // The admin panel is server-rendered (EJS) — redirect there instead of
    // rendering it inside the SPA, which only knew about role === 'admin'.
    if (route.name === 'admin') {
      if (!window.Auth.isAdmin()) {
        window.UI.notify('Acceso solo para administradores', 'error');
        navigate('dashboard');
        return;
      }
      // Hard navigate to the server-rendered admin page (relative path works
      // under the /run/<projectId>/ proxy).
      window.location.href = 'admin';
      return;
    }

    var fn = routes[route.name];
    if (!fn) { navigate(user ? 'dashboard' : 'landing'); return; }

    if (currentCleanup) { try { currentCleanup(); } catch (e) {} }
    currentCleanup = null;

    var app = document.getElementById('app');
    app.innerHTML = '';
    try {
      var maybeCleanup = await fn(app, route.params);
      if (typeof maybeCleanup === 'function') currentCleanup = maybeCleanup;
    } catch (err) {
      console.error('Route render error', err);
      window.UI.notify('Error al cargar la página', 'error');
    }
  }

  function start() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  window.Router = { register: register, navigate: navigate, start: start, parseHash: parseHash };
})();
