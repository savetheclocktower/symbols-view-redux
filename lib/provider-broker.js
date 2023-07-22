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

  observeProvider (provider) {
    let disposable = new CompositeDisposable();
    this.providerSubscriptions.set(provider, disposable);

    // Providers can implement `onShouldClearCache` when they want to control
    // when symbols they provide are no longer valid.
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

  // Boost the relevance score of certain packages based on their position in
  // the settings value. If there are 5 providers listed, the first one gets a
  // five-point boost; the second a four-point boost; and so on.
  getScoreBoost (packageName, preferredPackages = []) {
    if (packageName === 'unknown') return 0;
    let index = preferredPackages.indexOf(packageName);
    if (index === -1) return 0;
    let scoreBoost = preferredPackages.length - index;
    return scoreBoost;
  }

  async select (meta) {
    console.debug(`ProviderBroker#select choosing among ${this.providers.length} candidates:`, this.providers);
    console.debug('Metadata is:', meta);
    let exclusivesByScore = [];
    let results = [];

    let preferredPackages = atom.config.get('symbols-view-redux.preferCertainProviders');

    let answers = this.providers.map(provider => {
      // TODO: This method can reluctantly go async because language clients
      // might have to ask their servers about capabilities. We must introduce
      // a timeout value here so that we don't wait indefinitely for providers
      // to respond.
      return provider.canProvideSymbols(meta);
      // return timeout(provider.canProvideSymbols(meta), 500);
    });

    let outcomes = await Promise.allSettled(answers);

    for (let [index, provider] of this.providers.entries()) {
      let outcome = outcomes[index];
      if (outcome.status === 'rejected') continue;
      let { value: score } = outcome;
      let packageName = provider?.packageName ?? 'unknown';
      let isExclusive = provider?.isExclusive ?? false;
      console.debug('Score for', provider.name, 'is:', score);
      if (!score) continue;
      if (score === true) score = 1;
      score += this.getScoreBoost(packageName, preferredPackages);

      if (isExclusive) {
        // “Exclusive” providers get put aside until the end. We'll pick the
        // _one_ that has the highest score.
        exclusivesByScore.push({ provider, score });
      } else {
        // Non-exclusive providers go into the pile because we know we'll be
        // using them all.
        results.push(provider);
      }
    }

    if (exclusivesByScore.length > 0) {
      exclusivesByScore.sort((a, b) => b.score - a.score);
      results.unshift(exclusivesByScore[0].provider);
    }

    console.debug('Returned providers:', results);

    return results;
  }
};
