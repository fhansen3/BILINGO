(function () {
  'use strict';

  async function boot() {
    await window.Auth.check();
    window.Router.start();
  }

  boot();
})();
