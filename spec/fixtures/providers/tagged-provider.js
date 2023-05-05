const { Point } = require('atom');
const path = require('path');

function last (arr) {
  return arr[arr.length - 1];
}

module.exports = {
  packageName: 'symbol-provider-tagged',
  name: 'Tagged',
  isExclusive: true,
  canProvideSymbols (meta) {
    if (!meta.type === 'project') return false;
    return true;
  },
  getSymbols (meta) {
    let root = last(atom.project.getPaths());
    console.log('TaggedProvider.getSymbols', meta);
    let { editor, type } = meta;
    if (type !== 'project') return [];
    let results = [
      {
        directory: root,
        file: 'tagged.js',
        position: new Point(2, 10),
        name: 'callMeMaybe'
      }
    ];
    console.log('returning:', results);
    return results;
  }
};
