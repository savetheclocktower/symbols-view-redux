const { CompositeDisposable, Emitter } = require('atom');

module.exports = class ProviderBroker {
  constructor () {
    this.providers = [];
    this.providerSubscriptions = new Map();
    this.subscriptions = new CompositeDisposable();
    this.emitter = new Emitter();
  }

  add (...providers) {
    for (let provider of providers) {
      this.providers.push(provider);
      this.emitter.emit('did-add-provider', provider);
      this.observeProvider(provider);
    }
  }

  remove (...providers) {
    for (let provider of providers) {
      let index = this.providers.indexOf(provider);
      if (index === -1) continue;
      this.providers.splice(index, 1);
      this.emitter.emit('did-remove-provider', provider);
      this.stopObservingProvider(provider);
    }
  }

  observeProvider (provider) {
    let disposable = new CompositeDisposable();
    this.providerSubscriptions.set(provider, disposable);
    if (!provider.onShouldClearCache) return;
    disposable.add(
      provider.onShouldClearCache((...args) => {
        this.emitter.emit('should-clear-cache', ...args);
      })
    );
  }

  stopObservingProvider (provider) {
    let disposable = this.providerSubscriptions.get(provider);
    this.providerSubscriptions.delete(provider);
    disposable?.dispose;
  }

  destroy () {
    for (let provider of this.providers) {
      provider?.destroy?.();
      this.emitter.emit('did-remove-provider', provider);
    }
  }

  onDidAddProvider (callback) {
    return this.emitter.on('did-add-provider', callback);
  }

  onDidRemoveProvider (callback) {
    return this.emitter.on('did-remove-provider', callback);
  }

  onShouldClearCache (callback) {
    return this.emitter.on('should-clear-cache', callback);
  }

  getScoreBoost (packageName, preferredPackages) {
    if (packageName === 'unknown') return 0;
    let index = preferredPackages.indexOf(packageName);
    if (index === -1) return 0;
    let scoreBoost = preferredPackages.length - index;
    return scoreBoost;
  }

  select (meta) {
    // console.log(`ProviderBroker#select choosing among ${this.providers.length} candidates:`, this.providers);
    let scores = [];

    let preferredPackages = atom.config.get('symbols-view-plus.preferCertainProviders');

    for (let provider of this.providers) {
      let packageName = provider?.getPackageName?.() ?? 'unknown';
      let score = provider.canProvideSymbols(meta);
      if (!score) continue;
      if (score === true) score = 1;

      score += this.getScoreBoost(packageName, preferredPackages);

      // TODO: Consult the settings and boost the score accordingly?
      scores.push({ provider, score });
    }

    if (scores.length === 0) return null;

    scores.sort((a, b) => b.score - a.score);
    return scores[0].provider;
  }
};
