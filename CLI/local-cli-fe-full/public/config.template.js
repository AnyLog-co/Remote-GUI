(function () {
  const backendPort = "__REMOTE_GUI_BE__" === "__REMOTE_GUI_BE__" ? "8080" : "__REMOTE_GUI_BE__";

  window._env_ = {
    VITE_API_URL: `http://${window.location.hostname}:${backendPort}`,
    REMOTE_GUI_BE: backendPort
  };
})();
