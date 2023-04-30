const SymbolsView = require('./symbols-view');

module.exports = class ProjectView extends SymbolsView {
  constructor (stack, broker) {
    // TODO: Do these defaults make sense? Should we allow a provider to
    // override them?
    super(stack, broker, {
      emptyMessage: 'Project has no symbols or is empty',
      maxResults: 10
    });

    this.reloadTags = true;
  }

  destroy () {
    return super.destroy();
  }

  toggle () {
    if (this.panel.isVisible()) {
      this.cancel();
    } else {
      this.populate();
      this.attach();
    }
  }

  didCancelSelection () {
    this.abortController?.abort();
    super.didCancelSelection();
  }

  didConfirmEmptySelection () {
    this.abortController?.abort();
    super.didConfirmEmptySelection();
  }

  async populate () {
    if (this.tags) {
      await this.selectListView.update({ items: this.tags });
    }

    if (this.reloadTags) {
      this.abortController?.abort();
      this.abortController = new AbortController();
      this.reloadTags = false;
      let meta = {
        type: 'project',
        paths: atom.project.getPaths(),
        editor: atom.workspace.getActiveTextEditor()
      };
      let provider = this.broker.select(meta);

      if (!provider) {
        // TODO
        return;
      }

      let listViewOptions = {
        loadingMessage: this.tags ?
          `Reloading project symbols\u2026` :
          `Loading project symbols\u2026`
      };

      if (!this.tags) listViewOptions.loadingBadge = 0;
      await this.selectListView.update(listViewOptions);

      let tags = await provider.getSymbolsInProject({
        signal: this.abortController.signal,
        ...meta
      });

      this.tags = tags;
      this.reloadTags = this.tags.length === 0;

      this.selectListView.update({
        loadingMessage: null,
        loadingBadge: null,
        items: this.tags
      });
    }
  }
};
