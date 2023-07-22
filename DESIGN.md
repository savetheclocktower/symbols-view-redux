### The basics

* Provider/consumer model, like `autocomplete-plus`. Uses services to connect to packages that can provide symbols.
* Two kinds of providers:
  * “Exclusive” providers, each of which can be the “main” provider for a given task. A provider is exclusive when it wants to fulfill the standard task of a symbols provider (expose names/locations of functions, classes, and other important pieces of code) and would provide largely the same symbols as another exclusive provider. For instance: a `ctags`-based provider, a tree-sitter–based provider, and an LSP-based provider would likely provide very similar symbols for a given file.
  * “Supplementary” providers, each of which can provide special-purpose symbols that are unlikely to be provided by any other provider, exclusive or otherwise. Examples:
    * a provider that turns every “banner” comment into a symbol
    * a provider that turns Jasmine `describe`s and `it`s into symbols
* All providers register with `symbols-view` upon activation and expose a method that lets them indicate whether they’d support a hypothetical symbols-view task
* When a command like “toggle file symbols” is invoked, `symbols-view` will use these methods to pick the “best” exclusive provider, along with any supplementary providers that qualify, and will wait for each one to provide symbols
* The UI will not change, except for an opt-in setting that will show the source of each symbol in the list

### Envisioned providers

#### Exclusive

* `symbol-provider-ctags` (spinning the current symbol provider off into its own package).
  * PROS: good compatibility, doesn’t require a specific language mode.
  * CONS: works only with files on disk, and is useless or inaccurate when dealing with new or heavily modified files. Supports project-wide symbol search, but only via a `TAGS` file that the user must generate without any help from the package (though we could change this)
* `symbol-provider-tree-sitter` (using [tags queries](https://tree-sitter.github.io/tree-sitter/code-navigation-systems) whenever the user is using a tree-sitter grammar).
  * PROS: Fast; works with the contents of the buffer rather than what’s on disk, so will do just fine with new or modified files.
  * CONS: User must be using a tree-sitter grammar. Could do project-wide search in theory, but would be tricky.
* `generic-lsp` — or something like it, or any package that wraps a language server — could register as a symbol provider.
  * PROS: If the language server supports it, could easily do any sort of symbol search, whether local or project-wide.
  * CONS: Language servers are black boxes; they tend to be complicated and not as portable as the spec envisons them to be. Some “glue” code might be needed.

#### Supplementary

* `symbol-provider-banner-comments` — exposes any comment that is formatted like

  ```js
  // THIS COMMENT RIGHT HERE
  // =======================
  ```

  with possible configurability.

* `symbol-provider-jasmine` — exposes `describe`/`it` blocks as symbols. This is built-in behavior in current `symbols-view`, and would kick in only if we’re in a tree-sitter grammar; `symbol-provider-ctags` would take care of this in non-tree-sitter contexts as it does now.
* `symbol-provider-bookmarks` — could expose any [bookmarked lines in the editor](https://github.com/pulsar-edit/bookmarks) as symbols.


## Other ideas

* We could do away with the exclusive/supplementary distinction, and just consolidate all results that appeared to be duplicates, using some heuristic to pick a winning symbol in each case. But it’d be wasteful.
