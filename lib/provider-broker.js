const { CompositeDisposable, Emitter } = require('atom');

class InvalidProviderError extends Error {
  constructor (faults, provider) {
    let packageName = provider.packageName ?
      `the ${provider.packageName} provider`
      : 'a symbol provider';
    let message = `symbols-view failed to consume ${packageName} because certain properties are invalid: ${faults.join(', ')}. Please fix these faults or contact the package author.`;
    super(message);
    this.name = 'InvalidProviderError';
  }
}

module.exports = class ProviderBroker {
  constructor () {
    this.providers = [];
    this.providerSubscriptions = new Map();
    this.subscriptions = new CompositeDisposable();
    this.emitter = new Emitter();
  }

  add (...providers) {
    for (let provider of providers) {
      try {
        this.validateSymbolProvider(provider);
      } catch (err) {
        console.warn(err.message);
        continue;
      }
      this.providers.push(provider);
      this.emitter.emit('did-add-provider', provider);
      this.observeProvider(provider);
    }
  }

  validateSymbolProvider (provider) {
    let faults = [];
    if (typeof provider.name !== 'string') faults.push('name');
    if (typeof provider.packageName !== 'string') faults.push('packageName');
    if (typeof provider.canProvideSymbols !== 'function')
      faults.push('canProvideSymbols');
    if (typeof provider.getSymbols !== 'function')
      faults.push('getSymbols');

    if (faults.length > 0) {
      throw new InvalidProviderError(faults, provider);
    }
  }

  remove (...providers) {
    for (let provider of providers) {
      let index = this.providers.indexOf(provider);
      // Providers that were invalid may not have been added. Not a problem.
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
        this.emitter.emit('should-clear-cache', provider, ...args);
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

  getScoreBoost (packageName, preferredPackages = []) {
    if (packageName === 'unknown') return 0;
    let index = preferredPackages.indexOf(packageName);
    if (index === -1) return 0;
    let scoreBoost = preferredPackages.length - index;
    return scoreBoost;
  }

  select (meta) {
    console.debug(`ProviderBroker#select choosing among ${this.providers.length} candidates:`, this.providers);
    let exclusivesByScore = [];
    let results = [];

    let preferredPackages = atom.config.get('symbols-view-plus.preferCertainProviders');

    for (let provider of this.providers) {
      let packageName = provider?.packageName ?? 'unknown';
      let isExclusive = provider?.isExclusive ?? false;
      let score = provider.canProvideSymbols(meta);
      if (!score) continue;
      if (isExclusive)
      if (score === true) score = 1;

      score += this.getScoreBoost(packageName, preferredPackages);

      // TODO: Consult the settings and boost the score accordingly?
      if (isExclusive) {
        exclusivesByScore.push({ provider, score });
      } else {
        results.push(provider);
      }
    }

    if (exclusivesByScore.length > 0) {
      exclusivesByScore.sort((a, b) => b.score - a.score);
      results.unshift(exclusivesByScore[0].provider);
    }

    return results;
  }
};
