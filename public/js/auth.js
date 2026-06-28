(function () {
  'use strict';

  var currentUser = null;

  async function check() {
    try {
      currentUser = await window.API.get('api/auth/me');
      if (currentUser && window.Notifications) window.Notifications.start();
      return currentUser;
    } catch (err) {
      currentUser = null;
      return null;
    }
  }

  async function login(email, password) {
    var res = await window.API.post('api/auth/login', { email: email, password: password });
    currentUser = res.user;
    if (currentUser && window.Notifications) window.Notifications.start();
    return res.user;
  }

  async function register(data) {
    var res = await window.API.post('api/auth/register', data);
    currentUser = res.user;
    if (currentUser && window.Notifications) window.Notifications.start();
    return res.user;
  }

  async function logout() {
    try { await window.API.post('api/auth/logout', {}); } catch (e) {}
    currentUser = null;
    if (window.Notifications) window.Notifications.stop();
  }

  function getUser() { return currentUser; }
  function isAdmin() { return currentUser && currentUser.role === 'admin'; }

  window.Auth = { check: check, login: login, register: register, logout: logout, getUser: getUser, isAdmin: isAdmin };
})();
