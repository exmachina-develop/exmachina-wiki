(function () {
  var t = 'light';
  try { t = localStorage.getItem('exm_theme') === 'dark' ? 'dark' : 'light'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
})();
