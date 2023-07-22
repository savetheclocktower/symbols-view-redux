const murmur = require('murmurhash-js');
const BADGE_TEXT_HASH_MAP = new Map();
const el = require('./element-builder');

// Ensures an object can be iterated over.
//
// The contract with the symbol providers is that they return an object that
// gives us symbol objects when we iterate over it. It'll probably be an array,
// but we're cool with anything iterable.
function isIterable (obj) {
  return typeof obj[Symbol.iterator] === 'function';
}

// Given a string of text, returns a hexadecimal character from `0` to `f` to
// represent a classification “bucket”.
//
// The goal here is to give each tag a color such that (a) two things with the
// same tag will have badges of identical colors, and (b) two things with
// different tags are very likely to have badges of different colors. We use a
// fast (non-cryptographic) hashing algorithm, convert its return integer to
// hex, then tacke the final character; this, in effect, gives a piece of text
// an equal chance of being sorted into any of sixteen random buckets.
//
// In the CSS, we generate sixteen badge colors based on the user's UI theme;
// they are identical in saturation and brightness and vary only in hue.
function getBadgeTextVariant (text) {
  if (BADGE_TEXT_HASH_MAP.has(text)) {
    return BADGE_TEXT_HASH_MAP.get(text);
  }
  let hash = murmur.murmur3(text, 'symbols-view-redux').toString(16);
  let variantType = hash.charAt(hash.length - 1);
  BADGE_TEXT_HASH_MAP.set(text, variantType);
  return variantType;
}

function timeout (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function badge (text, { variant = false } = {}) {
  let classNames = `.badge.badge-info.badge-flexible.badge-symbol-tag`;
  if (variant) {
    let variantType = getBadgeTextVariant(text);
    classNames += `.symbols-view-badge-variant-${variantType}`;
  }
  return el(`span${classNames}`, text);
}


module.exports = {
  badge,
  isIterable,
  timeout
};
