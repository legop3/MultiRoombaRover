(function () {
  const modules = {};
  const cache = {};

  window.registerModule = function (name, factory) {
    modules[name] = factory;
  };

  window.requireModule = function (name) {
    if (cache[name]) {
      return cache[name];
    }
    const factory = modules[name];
    if (!factory) {
      throw new Error(`Module ${name} not found`);
    }
    const exports = {};
    cache[name] = exports;
    factory(requireModule, exports);
    return exports;
  };
})();
