const { Disposable } = require('atom');
const Config = require('./config');
const ProviderBroker = require('./provider-broker');

module.exports = {
  activate () {
    Config.activate();
    this.stack = [];
    this.broker = new ProviderBroker();

    this.workspaceSubscription = atom.commands.add(
      'atom-workspace',
      {
        'symbols-view-redux:toggle-project-symbols': () => {
          this.createProjectView().toggle();
        },
        'symbols-view-redux:show-active-providers': () => {
          this.showActiveProviders();
        }
      }
    );

    this.editorSubscription = atom.commands.add(
      'atom-text-editor',
      {
        'symbols-view-redux:toggle-file-symbols': () => {
          this.createFileView().toggle();
        },
        'symbols-view-redux:go-to-declaration': () => {
          this.createGoToView().toggle();
        },
        'symbols-view-redux:return-from-declaration': () => {
          this.createGoBackView().toggle();
        }
      }
    );
  },

  deactivate () {
    this.fileView?.destroy();
    this.fileView = null;

    this.projectView?.destroy();
    this.projectView = null;

    this.goToView?.destroy();
    this.goToView = null;

    this.goBackView?.destroy();
    this.goBackView = null;

    this.workspaceSubscription?.dispose();
    this.workspaceSubscription = null;

    this.editorSubscription?.dispose();
    this.editorSubscription = null;

    this.broker?.destroy();
    this.broker = null;

    this.subscriptions?.dispose();
    this.subscriptions = null;
  },

  consumeSymbolProvider (provider) {
    if (Array.isArray(provider)) {
      this.broker.add(...provider);
    } else {
      this.broker.add(provider);
    }

    return new Disposable(() => {
      if (Array.isArray(provider)) {
        this.broker.remove(...provider);
      } else {
        this.broker.remove(provider);
      }
    });
  },

  createFileView () {
    if (this.fileView) return this.fileView;

    const FileView = require('./file-view');
    this.fileView = new FileView(this.stack, this.broker);
    return this.fileView;
  },

  createProjectView () {
    if (this.projectView) return this.projectView;

    const ProjectView = require('./project-view');
    this.projectView = new ProjectView(this.stack, this.broker);
    return this.projectView;
  },

  createGoToView () {
    if (this.goToView) return this.goToView;

    const GoToView = require('./go-to-view');
    this.goToView = new GoToView(this.stack, this.broker);
    return this.goToView;
  },

  createGoBackView () {
    if (this.goBackView) return this.goBackView;

    const GoBackView = require('./go-back-view');
    this.goBackView = new GoBackView(this.stack, this.broker);
    return this.goBackView;
  },

  showActiveProviders () {
    let providerList = [];
    for (let provider of this.broker.providers) {
      providerList.push({ name: provider.name, packageName: provider.packageName });
    }

    let message = providerList.map(
      p => `* **${p.name}** provided by \`${p.packageName}\``
    ).join('\n');

    atom.notifications.addInfo(
      'Symbols View Redux providers',
      {
        description: message,
        dismissable: true,
        buttons: [
          {
            text: 'Copy',
            onDidClick () {
              atom.clipboard.write(message.join('\n'));
            }
          }
        ]
      }
    );

  }
};
