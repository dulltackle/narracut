import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity2.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path) {
      const ctrl = callVisitor(key, node, visitor, path);
      if (identity2.isNode(ctrl) || identity2.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visit_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity2.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity2.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = visit_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity2.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path) {
      const ctrl = await callVisitor(key, node, visitor, path);
      if (identity2.isNode(ctrl) || identity2.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visitAsync_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity2.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity2.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path) {
      if (typeof visitor === "function")
        return visitor(key, node, path);
      if (identity2.isMap(node))
        return visitor.Map?.(key, node, path);
      if (identity2.isSeq(node))
        return visitor.Seq?.(key, node, path);
      if (identity2.isPair(node))
        return visitor.Pair?.(key, node, path);
      if (identity2.isScalar(node))
        return visitor.Scalar?.(key, node, path);
      if (identity2.isAlias(node))
        return visitor.Alias?.(key, node, path);
      return void 0;
    }
    function replaceNode(key, path, node) {
      const parent = path[path.length - 1];
      if (identity2.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity2.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity2.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity2.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity2.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity2.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity2.isScalar(ref.node) || identity2.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity2.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity2 = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity2.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity2.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity2 = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity2.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity2.isAlias(node) || identity2.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity2.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity2.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity2.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity2.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity2 = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity2.isDocument(value))
        value = value.contents;
      if (identity2.isNode(value))
        return value;
      if (identity2.isPair(value)) {
        const map = ctx.schema[identity2.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity2.MAP] : Symbol.iterator in Object(value) ? schema[identity2.SEQ] : schema[identity2.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity2 = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path, value) {
      let v = value;
      for (let i = path.length - 1; i >= 0; --i) {
        const k = path[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity2.isNode(it) || identity2.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path, value) {
        if (isEmptyPath(path))
          this.add(value);
        else {
          const [key, ...rest] = path;
          const node = this.get(key, true);
          if (identity2.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity2.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity2.isScalar(node) ? node.value : node;
        else
          return identity2.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity2.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity2.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity2.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        const [key, ...rest] = path;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity2.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity2 = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity2.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity2.isScalar(node) || identity2.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify2(item, ctx, onComment, onChompKeep) {
      if (identity2.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity2.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity2.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity2.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity2.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify2;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var Scalar = require_Scalar();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity2.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity2.isCollection(key) || !identity2.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity2.isCollection(key) || (identity2.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify2.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity2.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity2.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity2.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify2.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity2.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity2.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity2.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity2.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity2.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify2 = require_stringify();
    var identity2 = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity2.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity2.isNode(key) && ctx?.doc) {
        const strCtx = stringify2.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity2 = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity2.NODE_TYPE, { value: identity2.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity2.isNode(key))
          key = key.clone(schema);
        if (identity2.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify3 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify3(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity2.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity2.isPair(item)) {
          const ik = identity2.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify2.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity2.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity2.isPair(item)) {
          const ik = identity2.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity2.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify2.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity2 = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity2.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity2.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity2.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity2.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity2.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity2.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity2.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity2.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity2.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity2 = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity2.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity2.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity2.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity2.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity2.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity2.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity2.isPair(item))
            continue;
          else if (identity2.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity2.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity2.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity2.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity2.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity2.isPair(pair) ? identity2.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity2.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity2.MAP, { value: map.map });
        Object.defineProperty(this, identity2.SCALAR, { value: string.string });
        Object.defineProperty(this, identity2.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify2.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity2.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify2.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify2.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity2 = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity2.NODE_TYPE, { value: identity2.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity2.NODE_TYPE]: { value: identity2.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity2.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity2.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        if (Collection.isEmptyPath(path)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity2.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        if (Collection.isEmptyPath(path))
          return !keepScalar && identity2.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity2.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity2.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path) {
        if (Collection.isEmptyPath(path))
          return this.contents !== void 0;
        return identity2.isCollection(this.contents) ? this.contents.hasIn(path) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        if (Collection.isEmptyPath(path)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity2.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity2.isScalar(a) && identity2.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep: sep3, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep3?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep3) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep3 ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep3, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep3 = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep3 + cb;
              sep3 = "";
              break;
            }
            case "newline":
              if (comment)
                sep3 += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep: sep3, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep3?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep3 && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity2.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep3 && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep3, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep3 ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep3)
                for (const st of sep3) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep3, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity2.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep3 = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep3 + indent.slice(trimIndent) + content;
          sep3 = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep3 === " ")
            sep3 = "\n";
          else if (!prevMoreIndented && sep3 === "\n")
            sep3 = "\n\n";
          value += sep3 + indent.slice(trimIndent) + content;
          sep3 = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep3 === "\n")
            value += "\n";
          else
            sep3 = "\n";
        } else {
          value += sep3 + content;
          sep3 = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
        line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy;
        line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1];
      let sep3 = " ";
      let pos = first.lastIndex;
      line.lastIndex = pos;
      while (match = line.exec(source)) {
        if (match[1] === "") {
          if (sep3 === "\n")
            res += sep3;
          else
            sep3 = "\n";
        } else {
          res += sep3 + match[1];
          sep3 = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep3 + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity2 = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity2.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity2.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity2.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity2.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity2.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity2.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity2.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity2 = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity2.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity2 = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity2.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity2.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify2 = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep: sep3, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep3)
        for (const st of sep3)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify2;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path) => {
      let item = cst;
      for (const [field, index] of path) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path) => {
      const parent = visit.itemAtPath(cst, path.slice(0, -1));
      const field = path[path.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path, item, visitor) {
      let ctrl = visitor(item, path);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep3;
          if (scalar.end) {
            sep3 = scalar.end;
            sep3.push(this.sourceToken);
            delete scalar.end;
          } else
            sep3 = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep: sep3 }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep3 = it.sep;
                  sep3.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep: sep3 }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep3 = fc.end.splice(1, fc.end.length);
            sep3.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep: sep3 }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity2 = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse2(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify2(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity2.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse2;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument;
    exports.stringify = stringify2;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity2 = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity2.isAlias;
    exports.isCollection = identity2.isCollection;
    exports.isDocument = identity2.isDocument;
    exports.isMap = identity2.isMap;
    exports.isNode = identity2.isNode;
    exports.isPair = identity2.isPair;
    exports.isScalar = identity2.isScalar;
    exports.isSeq = identity2.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/constants.js
var require_constants = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/constants.js"(exports, module) {
    "use strict";
    var SEMVER_SPEC_VERSION = "2.0.0";
    var MAX_LENGTH = 256;
    var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
    9007199254740991;
    var MAX_SAFE_COMPONENT_LENGTH = 16;
    var MAX_SAFE_BUILD_LENGTH = MAX_LENGTH - 6;
    var RELEASE_TYPES = [
      "major",
      "premajor",
      "minor",
      "preminor",
      "patch",
      "prepatch",
      "prerelease"
    ];
    module.exports = {
      MAX_LENGTH,
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_SAFE_INTEGER,
      RELEASE_TYPES,
      SEMVER_SPEC_VERSION,
      FLAG_INCLUDE_PRERELEASE: 1,
      FLAG_LOOSE: 2
    };
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/debug.js
var require_debug = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/debug.js"(exports, module) {
    "use strict";
    var debug = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
    };
    module.exports = debug;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/re.js
var require_re = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/re.js"(exports, module) {
    "use strict";
    var {
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_LENGTH
    } = require_constants();
    var debug = require_debug();
    exports = module.exports = {};
    var re = exports.re = [];
    var safeRe = exports.safeRe = [];
    var src = exports.src = [];
    var safeSrc = exports.safeSrc = [];
    var t = exports.t = {};
    var R = 0;
    var LETTERDASHNUMBER = "[a-zA-Z0-9-]";
    var safeRegexReplacements = [
      ["\\s", 1],
      ["\\d", MAX_LENGTH],
      [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH]
    ];
    var makeSafeRegex = (value) => {
      for (const [token, max] of safeRegexReplacements) {
        value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
      }
      return value;
    };
    var createToken = (name, value, isGlobal) => {
      const safe = makeSafeRegex(value);
      const index = R++;
      debug(name, index, value);
      t[name] = index;
      src[index] = value;
      safeSrc[index] = safe;
      re[index] = new RegExp(value, isGlobal ? "g" : void 0);
      safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
    };
    createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
    createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
    createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
    createToken("MAINVERSION", `(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})`);
    createToken("MAINVERSIONLOOSE", `(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASEIDENTIFIER", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIER]})`);
    createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASE", `(?:-(${src[t.PRERELEASEIDENTIFIER]}(?:\\.${src[t.PRERELEASEIDENTIFIER]})*))`);
    createToken("PRERELEASELOOSE", `(?:-?(${src[t.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t.PRERELEASEIDENTIFIERLOOSE]})*))`);
    createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
    createToken("BUILD", `(?:\\+(${src[t.BUILDIDENTIFIER]}(?:\\.${src[t.BUILDIDENTIFIER]})*))`);
    createToken("FULLPLAIN", `v?${src[t.MAINVERSION]}${src[t.PRERELEASE]}?${src[t.BUILD]}?`);
    createToken("FULL", `^${src[t.FULLPLAIN]}$`);
    createToken("LOOSEPLAIN", `[v=\\s]*${src[t.MAINVERSIONLOOSE]}${src[t.PRERELEASELOOSE]}?${src[t.BUILD]}?`);
    createToken("LOOSE", `^${src[t.LOOSEPLAIN]}$`);
    createToken("GTLT", "((?:<|>)?=?)");
    createToken("XRANGEIDENTIFIERLOOSE", `${src[t.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
    createToken("XRANGEIDENTIFIER", `${src[t.NUMERICIDENTIFIER]}|x|X|\\*`);
    createToken("XRANGEPLAIN", `[v=\\s]*(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:${src[t.PRERELEASE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:${src[t.PRERELEASELOOSE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAIN]}$`);
    createToken("XRANGELOOSE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COERCEPLAIN", `${"(^|[^\\d])(\\d{1,"}${MAX_SAFE_COMPONENT_LENGTH}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?`);
    createToken("COERCE", `${src[t.COERCEPLAIN]}(?:$|[^\\d])`);
    createToken("COERCEFULL", src[t.COERCEPLAIN] + `(?:${src[t.PRERELEASE]})?(?:${src[t.BUILD]})?(?:$|[^\\d])`);
    createToken("COERCERTL", src[t.COERCE], true);
    createToken("COERCERTLFULL", src[t.COERCEFULL], true);
    createToken("LONETILDE", "(?:~>?)");
    createToken("TILDETRIM", `(\\s*)${src[t.LONETILDE]}\\s+`, true);
    exports.tildeTrimReplace = "$1~";
    createToken("TILDE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAIN]}$`);
    createToken("TILDELOOSE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("LONECARET", "(?:\\^)");
    createToken("CARETTRIM", `(\\s*)${src[t.LONECARET]}\\s+`, true);
    exports.caretTrimReplace = "$1^";
    createToken("CARET", `^${src[t.LONECARET]}${src[t.XRANGEPLAIN]}$`);
    createToken("CARETLOOSE", `^${src[t.LONECARET]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COMPARATORLOOSE", `^${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]})$|^$`);
    createToken("COMPARATOR", `^${src[t.GTLT]}\\s*(${src[t.FULLPLAIN]})$|^$`);
    createToken("COMPARATORTRIM", `(\\s*)${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]}|${src[t.XRANGEPLAIN]})`, true);
    exports.comparatorTrimReplace = "$1$2$3";
    createToken("HYPHENRANGE", `^\\s*(${src[t.XRANGEPLAIN]})\\s+-\\s+(${src[t.XRANGEPLAIN]})\\s*$`);
    createToken("HYPHENRANGELOOSE", `^\\s*(${src[t.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t.XRANGEPLAINLOOSE]})\\s*$`);
    createToken("STAR", "(<|>)?=?\\s*\\*");
    createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
    createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/parse-options.js
var require_parse_options = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/parse-options.js"(exports, module) {
    "use strict";
    var looseOption = Object.freeze({ loose: true });
    var emptyOpts = Object.freeze({});
    var parseOptions = (options) => {
      if (!options) {
        return emptyOpts;
      }
      if (typeof options !== "object") {
        return looseOption;
      }
      return options;
    };
    module.exports = parseOptions;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/identifiers.js
var require_identifiers = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/identifiers.js"(exports, module) {
    "use strict";
    var numeric = /^[0-9]+$/;
    var compareIdentifiers = (a, b) => {
      if (typeof a === "number" && typeof b === "number") {
        return a === b ? 0 : a < b ? -1 : 1;
      }
      const anum = numeric.test(a);
      const bnum = numeric.test(b);
      if (anum && bnum) {
        a = +a;
        b = +b;
      }
      return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
    };
    var rcompareIdentifiers = (a, b) => compareIdentifiers(b, a);
    module.exports = {
      compareIdentifiers,
      rcompareIdentifiers
    };
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/classes/semver.js
var require_semver = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/classes/semver.js"(exports, module) {
    "use strict";
    var debug = require_debug();
    var { MAX_LENGTH, MAX_SAFE_INTEGER } = require_constants();
    var { safeRe: re, t } = require_re();
    var parseOptions = require_parse_options();
    var { compareIdentifiers } = require_identifiers();
    var isPrereleaseIdentifier = (prerelease, identifier) => {
      const identifiers = identifier.split(".");
      if (identifiers.length > prerelease.length) {
        return false;
      }
      for (let i = 0; i < identifiers.length; i++) {
        if (compareIdentifiers(prerelease[i], identifiers[i]) !== 0) {
          return false;
        }
      }
      return true;
    };
    var SemVer = class _SemVer {
      constructor(version, options) {
        options = parseOptions(options);
        if (version instanceof _SemVer) {
          if (version.loose === !!options.loose && version.includePrerelease === !!options.includePrerelease) {
            return version;
          } else {
            version = version.version;
          }
        } else if (typeof version !== "string") {
          throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
        }
        if (version.length > MAX_LENGTH) {
          throw new TypeError(
            `version is longer than ${MAX_LENGTH} characters`
          );
        }
        debug("SemVer", version, options);
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        const m = version.trim().match(options.loose ? re[t.LOOSE] : re[t.FULL]);
        if (!m) {
          throw new TypeError(`Invalid Version: ${version}`);
        }
        this.raw = version;
        this.major = +m[1];
        this.minor = +m[2];
        this.patch = +m[3];
        if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
          throw new TypeError("Invalid major version");
        }
        if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
          throw new TypeError("Invalid minor version");
        }
        if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
          throw new TypeError("Invalid patch version");
        }
        if (!m[4]) {
          this.prerelease = [];
        } else {
          this.prerelease = m[4].split(".").map((id) => {
            if (/^[0-9]+$/.test(id)) {
              const num = +id;
              if (num >= 0 && num < MAX_SAFE_INTEGER) {
                return num;
              }
            }
            return id;
          });
        }
        this.build = m[5] ? m[5].split(".") : [];
        this.format();
      }
      format() {
        this.version = `${this.major}.${this.minor}.${this.patch}`;
        if (this.prerelease.length) {
          this.version += `-${this.prerelease.join(".")}`;
        }
        return this.version;
      }
      toString() {
        return this.version;
      }
      compare(other) {
        debug("SemVer.compare", this.version, this.options, other);
        if (!(other instanceof _SemVer)) {
          if (typeof other === "string" && other === this.version) {
            return 0;
          }
          other = new _SemVer(other, this.options);
        }
        if (other.version === this.version) {
          return 0;
        }
        return this.compareMain(other) || this.comparePre(other);
      }
      compareMain(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.major < other.major) {
          return -1;
        }
        if (this.major > other.major) {
          return 1;
        }
        if (this.minor < other.minor) {
          return -1;
        }
        if (this.minor > other.minor) {
          return 1;
        }
        if (this.patch < other.patch) {
          return -1;
        }
        if (this.patch > other.patch) {
          return 1;
        }
        return 0;
      }
      comparePre(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.prerelease.length && !other.prerelease.length) {
          return -1;
        } else if (!this.prerelease.length && other.prerelease.length) {
          return 1;
        } else if (!this.prerelease.length && !other.prerelease.length) {
          return 0;
        }
        let i = 0;
        do {
          const a = this.prerelease[i];
          const b = other.prerelease[i];
          debug("prerelease compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      compareBuild(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        let i = 0;
        do {
          const a = this.build[i];
          const b = other.build[i];
          debug("build compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      // preminor will bump the version up to the next minor release, and immediately
      // down to pre-release. premajor and prepatch work the same way.
      inc(release2, identifier, identifierBase) {
        if (release2.startsWith("pre")) {
          if (!identifier && identifierBase === false) {
            throw new Error("invalid increment argument: identifier is empty");
          }
          if (identifier) {
            const match = `-${identifier}`.match(this.options.loose ? re[t.PRERELEASELOOSE] : re[t.PRERELEASE]);
            if (!match || match[1] !== identifier) {
              throw new Error(`invalid identifier: ${identifier}`);
            }
          }
        }
        switch (release2) {
          case "premajor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor = 0;
            this.major++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "preminor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "prepatch":
            this.prerelease.length = 0;
            this.inc("patch", identifier, identifierBase);
            this.inc("pre", identifier, identifierBase);
            break;
          // If the input is a non-prerelease version, this acts the same as
          // prepatch.
          case "prerelease":
            if (this.prerelease.length === 0) {
              this.inc("patch", identifier, identifierBase);
            }
            this.inc("pre", identifier, identifierBase);
            break;
          case "release":
            if (this.prerelease.length === 0) {
              throw new Error(`version ${this.raw} is not a prerelease`);
            }
            this.prerelease.length = 0;
            break;
          case "major":
            if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) {
              this.major++;
            }
            this.minor = 0;
            this.patch = 0;
            this.prerelease = [];
            break;
          case "minor":
            if (this.patch !== 0 || this.prerelease.length === 0) {
              this.minor++;
            }
            this.patch = 0;
            this.prerelease = [];
            break;
          case "patch":
            if (this.prerelease.length === 0) {
              this.patch++;
            }
            this.prerelease = [];
            break;
          // This probably shouldn't be used publicly.
          // 1.0.0 'pre' would become 1.0.0-0 which is the wrong direction.
          case "pre": {
            const base = Number(identifierBase) ? 1 : 0;
            if (this.prerelease.length === 0) {
              this.prerelease = [base];
            } else {
              let i = this.prerelease.length;
              while (--i >= 0) {
                if (typeof this.prerelease[i] === "number") {
                  this.prerelease[i]++;
                  i = -2;
                }
              }
              if (i === -1) {
                if (identifier === this.prerelease.join(".") && identifierBase === false) {
                  throw new Error("invalid increment argument: identifier already exists");
                }
                this.prerelease.push(base);
              }
            }
            if (identifier) {
              let prerelease = [identifier, base];
              if (identifierBase === false) {
                prerelease = [identifier];
              }
              if (isPrereleaseIdentifier(this.prerelease, identifier)) {
                const prereleaseBase = this.prerelease[identifier.split(".").length];
                if (isNaN(prereleaseBase)) {
                  this.prerelease = prerelease;
                }
              } else {
                this.prerelease = prerelease;
              }
            }
            break;
          }
          default:
            throw new Error(`invalid increment argument: ${release2}`);
        }
        this.raw = this.format();
        if (this.build.length) {
          this.raw += `+${this.build.join(".")}`;
        }
        return this;
      }
    };
    module.exports = SemVer;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/parse.js
var require_parse = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/parse.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var parse2 = (version, options, throwErrors = false) => {
      if (version instanceof SemVer) {
        return version;
      }
      try {
        return new SemVer(version, options);
      } catch (er) {
        if (!throwErrors) {
          return null;
        }
        throw er;
      }
    };
    module.exports = parse2;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/valid.js
var require_valid = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/valid.js"(exports, module) {
    "use strict";
    var parse2 = require_parse();
    var valid2 = (version, options) => {
      const v = parse2(version, options);
      return v ? v.version : null;
    };
    module.exports = valid2;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/clean.js
var require_clean = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/clean.js"(exports, module) {
    "use strict";
    var parse2 = require_parse();
    var clean = (version, options) => {
      const s = parse2(version.trim().replace(/^[=v]+/, ""), options);
      return s ? s.version : null;
    };
    module.exports = clean;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/inc.js
var require_inc = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/inc.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var inc = (version, release2, options, identifier, identifierBase) => {
      if (typeof options === "string") {
        identifierBase = identifier;
        identifier = options;
        options = void 0;
      }
      try {
        return new SemVer(
          version instanceof SemVer ? version.version : version,
          options
        ).inc(release2, identifier, identifierBase).version;
      } catch (er) {
        return null;
      }
    };
    module.exports = inc;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/diff.js
var require_diff = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/diff.js"(exports, module) {
    "use strict";
    var parse2 = require_parse();
    var diff = (version1, version2) => {
      const v1 = parse2(version1, null, true);
      const v2 = parse2(version2, null, true);
      const comparison = v1.compare(v2);
      if (comparison === 0) {
        return null;
      }
      const v1Higher = comparison > 0;
      const highVersion = v1Higher ? v1 : v2;
      const lowVersion = v1Higher ? v2 : v1;
      const highHasPre = !!highVersion.prerelease.length;
      const lowHasPre = !!lowVersion.prerelease.length;
      if (lowHasPre && !highHasPre) {
        if (!lowVersion.patch && !lowVersion.minor) {
          return "major";
        }
        if (lowVersion.compareMain(highVersion) === 0) {
          if (lowVersion.minor && !lowVersion.patch) {
            return "minor";
          }
          return "patch";
        }
      }
      const prefix = highHasPre ? "pre" : "";
      if (v1.major !== v2.major) {
        return prefix + "major";
      }
      if (v1.minor !== v2.minor) {
        return prefix + "minor";
      }
      if (v1.patch !== v2.patch) {
        return prefix + "patch";
      }
      return "prerelease";
    };
    module.exports = diff;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/major.js
var require_major = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/major.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var major = (a, loose) => new SemVer(a, loose).major;
    module.exports = major;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/minor.js
var require_minor = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/minor.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var minor = (a, loose) => new SemVer(a, loose).minor;
    module.exports = minor;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/patch.js
var require_patch = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/patch.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var patch = (a, loose) => new SemVer(a, loose).patch;
    module.exports = patch;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/prerelease.js
var require_prerelease = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/prerelease.js"(exports, module) {
    "use strict";
    var parse2 = require_parse();
    var prerelease = (version, options) => {
      const parsed = parse2(version, options);
      return parsed && parsed.prerelease.length ? parsed.prerelease : null;
    };
    module.exports = prerelease;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/compare.js
var require_compare = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/compare.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var compare = (a, b, loose) => new SemVer(a, loose).compare(new SemVer(b, loose));
    module.exports = compare;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/rcompare.js
var require_rcompare = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/rcompare.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var rcompare2 = (a, b, loose) => compare(b, a, loose);
    module.exports = rcompare2;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/compare-loose.js
var require_compare_loose = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/compare-loose.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var compareLoose = (a, b) => compare(a, b, true);
    module.exports = compareLoose;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/compare-build.js
var require_compare_build = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/compare-build.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var compareBuild = (a, b, loose) => {
      const versionA = new SemVer(a, loose);
      const versionB = new SemVer(b, loose);
      return versionA.compare(versionB) || versionA.compareBuild(versionB);
    };
    module.exports = compareBuild;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/sort.js
var require_sort = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/sort.js"(exports, module) {
    "use strict";
    var compareBuild = require_compare_build();
    var sort = (list, loose) => list.sort((a, b) => compareBuild(a, b, loose));
    module.exports = sort;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/rsort.js
var require_rsort = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/rsort.js"(exports, module) {
    "use strict";
    var compareBuild = require_compare_build();
    var rsort = (list, loose) => list.sort((a, b) => compareBuild(b, a, loose));
    module.exports = rsort;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/gt.js
var require_gt = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/gt.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var gt = (a, b, loose) => compare(a, b, loose) > 0;
    module.exports = gt;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/lt.js
var require_lt = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/lt.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var lt = (a, b, loose) => compare(a, b, loose) < 0;
    module.exports = lt;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/eq.js
var require_eq = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/eq.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var eq = (a, b, loose) => compare(a, b, loose) === 0;
    module.exports = eq;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/neq.js
var require_neq = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/neq.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var neq = (a, b, loose) => compare(a, b, loose) !== 0;
    module.exports = neq;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/gte.js
var require_gte = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/gte.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var gte = (a, b, loose) => compare(a, b, loose) >= 0;
    module.exports = gte;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/lte.js
var require_lte = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/lte.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var lte = (a, b, loose) => compare(a, b, loose) <= 0;
    module.exports = lte;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/cmp.js
var require_cmp = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/cmp.js"(exports, module) {
    "use strict";
    var eq = require_eq();
    var neq = require_neq();
    var gt = require_gt();
    var gte = require_gte();
    var lt = require_lt();
    var lte = require_lte();
    var cmp = (a, op, b, loose) => {
      switch (op) {
        case "===":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a === b;
        case "!==":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a !== b;
        case "":
        case "=":
        case "==":
          return eq(a, b, loose);
        case "!=":
          return neq(a, b, loose);
        case ">":
          return gt(a, b, loose);
        case ">=":
          return gte(a, b, loose);
        case "<":
          return lt(a, b, loose);
        case "<=":
          return lte(a, b, loose);
        default:
          throw new TypeError(`Invalid operator: ${op}`);
      }
    };
    module.exports = cmp;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/coerce.js
var require_coerce = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/coerce.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var parse2 = require_parse();
    var { safeRe: re, t } = require_re();
    var coerce = (version, options) => {
      if (version instanceof SemVer) {
        return version;
      }
      if (typeof version === "number") {
        version = String(version);
      }
      if (typeof version !== "string") {
        return null;
      }
      options = options || {};
      let match = null;
      if (!options.rtl) {
        match = version.match(options.includePrerelease ? re[t.COERCEFULL] : re[t.COERCE]);
      } else {
        const coerceRtlRegex = options.includePrerelease ? re[t.COERCERTLFULL] : re[t.COERCERTL];
        let next;
        while ((next = coerceRtlRegex.exec(version)) && (!match || match.index + match[0].length !== version.length)) {
          if (!match || next.index + next[0].length !== match.index + match[0].length) {
            match = next;
          }
          coerceRtlRegex.lastIndex = next.index + next[1].length + next[2].length;
        }
        coerceRtlRegex.lastIndex = -1;
      }
      if (match === null) {
        return null;
      }
      const major = match[2];
      const minor = match[3] || "0";
      const patch = match[4] || "0";
      const prerelease = options.includePrerelease && match[5] ? `-${match[5]}` : "";
      const build = options.includePrerelease && match[6] ? `+${match[6]}` : "";
      return parse2(`${major}.${minor}.${patch}${prerelease}${build}`, options);
    };
    module.exports = coerce;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/truncate.js
var require_truncate = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/truncate.js"(exports, module) {
    "use strict";
    var parse2 = require_parse();
    var constants3 = require_constants();
    var SemVer = require_semver();
    var truncate = (version, truncation, options) => {
      if (!constants3.RELEASE_TYPES.includes(truncation)) {
        return null;
      }
      const clonedVersion = cloneInputVersion(version, options);
      return clonedVersion && doTruncation(clonedVersion, truncation);
    };
    var cloneInputVersion = (version, options) => {
      const versionStringToParse = version instanceof SemVer ? version.version : version;
      return parse2(versionStringToParse, options);
    };
    var doTruncation = (version, truncation) => {
      if (isPrerelease(truncation)) {
        return version.version;
      }
      version.prerelease = [];
      switch (truncation) {
        case "major":
          version.minor = 0;
          version.patch = 0;
          break;
        case "minor":
          version.patch = 0;
          break;
      }
      return version.format();
    };
    var isPrerelease = (type) => {
      return type.startsWith("pre");
    };
    module.exports = truncate;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/lrucache.js
var require_lrucache = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/lrucache.js"(exports, module) {
    "use strict";
    var LRUCache = class {
      constructor() {
        this.max = 1e3;
        this.map = /* @__PURE__ */ new Map();
      }
      get(key) {
        const value = this.map.get(key);
        if (value === void 0) {
          return void 0;
        } else {
          this.map.delete(key);
          this.map.set(key, value);
          return value;
        }
      }
      delete(key) {
        return this.map.delete(key);
      }
      set(key, value) {
        const deleted = this.delete(key);
        if (!deleted && value !== void 0) {
          if (this.map.size >= this.max) {
            const firstKey = this.map.keys().next().value;
            this.delete(firstKey);
          }
          this.map.set(key, value);
        }
        return this;
      }
    };
    module.exports = LRUCache;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/classes/range.js
var require_range = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/classes/range.js"(exports, module) {
    "use strict";
    var SPACE_CHARACTERS = /\s+/g;
    var Range = class _Range {
      constructor(range, options) {
        options = parseOptions(options);
        if (range instanceof _Range) {
          if (range.loose === !!options.loose && range.includePrerelease === !!options.includePrerelease) {
            return range;
          } else {
            return new _Range(range.raw, options);
          }
        }
        if (range instanceof Comparator) {
          this.raw = range.value;
          this.set = [[range]];
          this.formatted = void 0;
          return this;
        }
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        this.raw = range.trim().replace(SPACE_CHARACTERS, " ");
        this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length);
        if (!this.set.length) {
          throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
        }
        if (this.set.length > 1) {
          const first = this.set[0];
          this.set = this.set.filter((c) => !isNullSet(c[0]));
          if (this.set.length === 0) {
            this.set = [first];
          } else if (this.set.length > 1) {
            for (const c of this.set) {
              if (c.length === 1 && isAny(c[0])) {
                this.set = [c];
                break;
              }
            }
          }
        }
        this.formatted = void 0;
      }
      get range() {
        if (this.formatted === void 0) {
          this.formatted = "";
          for (let i = 0; i < this.set.length; i++) {
            if (i > 0) {
              this.formatted += "||";
            }
            const comps = this.set[i];
            for (let k = 0; k < comps.length; k++) {
              if (k > 0) {
                this.formatted += " ";
              }
              this.formatted += comps[k].toString().trim();
            }
          }
        }
        return this.formatted;
      }
      format() {
        return this.range;
      }
      toString() {
        return this.range;
      }
      parseRange(range) {
        range = range.replace(BUILDSTRIPRE, "");
        const memoOpts = (this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE);
        const memoKey = memoOpts + ":" + range;
        const cached = cache.get(memoKey);
        if (cached) {
          return cached;
        }
        const loose = this.options.loose;
        const hr = loose ? re[t.HYPHENRANGELOOSE] : re[t.HYPHENRANGE];
        range = range.replace(hr, hyphenReplace(this.options.includePrerelease));
        debug("hyphen replace", range);
        range = range.replace(re[t.COMPARATORTRIM], comparatorTrimReplace);
        debug("comparator trim", range);
        range = range.replace(re[t.TILDETRIM], tildeTrimReplace);
        debug("tilde trim", range);
        range = range.replace(re[t.CARETTRIM], caretTrimReplace);
        debug("caret trim", range);
        let rangeList = range.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
        if (loose) {
          rangeList = rangeList.filter((comp) => {
            debug("loose invalid filter", comp, this.options);
            return !!comp.match(re[t.COMPARATORLOOSE]);
          });
        }
        debug("range list", rangeList);
        const rangeMap = /* @__PURE__ */ new Map();
        const comparators = rangeList.map((comp) => new Comparator(comp, this.options));
        for (const comp of comparators) {
          if (isNullSet(comp)) {
            return [comp];
          }
          rangeMap.set(comp.value, comp);
        }
        if (rangeMap.size > 1 && rangeMap.has("")) {
          rangeMap.delete("");
        }
        const result = [...rangeMap.values()];
        cache.set(memoKey, result);
        return result;
      }
      intersects(range, options) {
        if (!(range instanceof _Range)) {
          throw new TypeError("a Range is required");
        }
        return this.set.some((thisComparators) => {
          return isSatisfiable(thisComparators, options) && range.set.some((rangeComparators) => {
            return isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => {
              return rangeComparators.every((rangeComparator) => {
                return thisComparator.intersects(rangeComparator, options);
              });
            });
          });
        });
      }
      // if ANY of the sets match ALL of its comparators, then pass
      test(version) {
        if (!version) {
          return false;
        }
        if (typeof version === "string") {
          try {
            version = new SemVer(version, this.options);
          } catch (er) {
            return false;
          }
        }
        for (let i = 0; i < this.set.length; i++) {
          if (testSet(this.set[i], version, this.options)) {
            return true;
          }
        }
        return false;
      }
    };
    module.exports = Range;
    var LRU = require_lrucache();
    var cache = new LRU();
    var parseOptions = require_parse_options();
    var Comparator = require_comparator();
    var debug = require_debug();
    var SemVer = require_semver();
    var {
      safeRe: re,
      src,
      t,
      comparatorTrimReplace,
      tildeTrimReplace,
      caretTrimReplace
    } = require_re();
    var { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = require_constants();
    var BUILDSTRIPRE = new RegExp(src[t.BUILD], "g");
    var isNullSet = (c) => c.value === "<0.0.0-0";
    var isAny = (c) => c.value === "";
    var isSatisfiable = (comparators, options) => {
      let result = true;
      const remainingComparators = comparators.slice();
      let testComparator = remainingComparators.pop();
      while (result && remainingComparators.length) {
        result = remainingComparators.every((otherComparator) => {
          return testComparator.intersects(otherComparator, options);
        });
        testComparator = remainingComparators.pop();
      }
      return result;
    };
    var parseComparator = (comp, options) => {
      comp = comp.replace(re[t.BUILD], "");
      debug("comp", comp, options);
      comp = replaceCarets(comp, options);
      debug("caret", comp);
      comp = replaceTildes(comp, options);
      debug("tildes", comp);
      comp = replaceXRanges(comp, options);
      debug("xrange", comp);
      comp = replaceStars(comp, options);
      debug("stars", comp);
      return comp;
    };
    var isX = (id) => !id || id.toLowerCase() === "x" || id === "*";
    var invalidXRangeOrder = (M, m, p) => isX(M) && !isX(m) || isX(m) && p && !isX(p);
    var replaceTildes = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" ");
    };
    var replaceTilde = (comp, options) => {
      const r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE];
      const z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("tilde", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
        } else if (pr) {
          debug("replaceTilde pr", pr);
          ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
        } else {
          ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
        }
        debug("tilde return", ret);
        return ret;
      });
    };
    var replaceCarets = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" ");
    };
    var replaceCaret = (comp, options) => {
      debug("caret", comp, options);
      const r = options.loose ? re[t.CARETLOOSE] : re[t.CARET];
      const z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("caret", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          if (M === "0") {
            ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
          } else {
            ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
          }
        } else if (pr) {
          debug("replaceCaret pr", pr);
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
          }
        } else {
          debug("no pr");
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
          }
        }
        debug("caret return", ret);
        return ret;
      });
    };
    var replaceXRanges = (comp, options) => {
      debug("replaceXRanges", comp, options);
      return comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ");
    };
    var replaceXRange = (comp, options) => {
      comp = comp.trim();
      const r = options.loose ? re[t.XRANGELOOSE] : re[t.XRANGE];
      return comp.replace(r, (ret, gtlt, M, m, p, pr) => {
        debug("xRange", comp, ret, gtlt, M, m, p, pr);
        if (invalidXRangeOrder(M, m, p)) {
          return comp;
        }
        const xM = isX(M);
        const xm = xM || isX(m);
        const xp = xm || isX(p);
        const anyX = xp;
        if (gtlt === "=" && anyX) {
          gtlt = "";
        }
        pr = options.includePrerelease ? "-0" : "";
        if (xM) {
          if (gtlt === ">" || gtlt === "<") {
            ret = "<0.0.0-0";
          } else {
            ret = "*";
          }
        } else if (gtlt && anyX) {
          if (xm) {
            m = 0;
          }
          p = 0;
          if (gtlt === ">") {
            gtlt = ">=";
            if (xm) {
              M = +M + 1;
              m = 0;
              p = 0;
            } else {
              m = +m + 1;
              p = 0;
            }
          } else if (gtlt === "<=") {
            gtlt = "<";
            if (xm) {
              M = +M + 1;
            } else {
              m = +m + 1;
            }
          }
          if (gtlt === "<") {
            pr = "-0";
          }
          ret = `${gtlt + M}.${m}.${p}${pr}`;
        } else if (xm) {
          ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
        } else if (xp) {
          ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
        }
        debug("xRange return", ret);
        return ret;
      });
    };
    var replaceStars = (comp, options) => {
      debug("replaceStars", comp, options);
      return comp.trim().replace(re[t.STAR], "");
    };
    var replaceGTE0 = (comp, options) => {
      debug("replaceGTE0", comp, options);
      return comp.trim().replace(re[options.includePrerelease ? t.GTE0PRE : t.GTE0], "");
    };
    var hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => {
      if (isX(fM)) {
        from = "";
      } else if (isX(fm)) {
        from = `>=${fM}.0.0${incPr ? "-0" : ""}`;
      } else if (isX(fp)) {
        from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}`;
      } else if (fpr) {
        from = `>=${from}`;
      } else {
        from = `>=${from}${incPr ? "-0" : ""}`;
      }
      if (isX(tM)) {
        to = "";
      } else if (isX(tm)) {
        to = `<${+tM + 1}.0.0-0`;
      } else if (isX(tp)) {
        to = `<${tM}.${+tm + 1}.0-0`;
      } else if (tpr) {
        to = `<=${tM}.${tm}.${tp}-${tpr}`;
      } else if (incPr) {
        to = `<${tM}.${tm}.${+tp + 1}-0`;
      } else {
        to = `<=${to}`;
      }
      return `${from} ${to}`.trim();
    };
    var testSet = (set, version, options) => {
      for (let i = 0; i < set.length; i++) {
        if (!set[i].test(version)) {
          return false;
        }
      }
      if (version.prerelease.length && !options.includePrerelease) {
        for (let i = 0; i < set.length; i++) {
          debug(set[i].semver);
          if (set[i].semver === Comparator.ANY) {
            continue;
          }
          if (set[i].semver.prerelease.length > 0) {
            const allowed = set[i].semver;
            if (allowed.major === version.major && allowed.minor === version.minor && allowed.patch === version.patch) {
              return true;
            }
          }
        }
        return false;
      }
      return true;
    };
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/classes/comparator.js
var require_comparator = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/classes/comparator.js"(exports, module) {
    "use strict";
    var ANY = /* @__PURE__ */ Symbol("SemVer ANY");
    var Comparator = class _Comparator {
      static get ANY() {
        return ANY;
      }
      constructor(comp, options) {
        options = parseOptions(options);
        if (comp instanceof _Comparator) {
          if (comp.loose === !!options.loose) {
            return comp;
          } else {
            comp = comp.value;
          }
        }
        comp = comp.trim().split(/\s+/).join(" ");
        debug("comparator", comp, options);
        this.options = options;
        this.loose = !!options.loose;
        this.parse(comp);
        if (this.semver === ANY) {
          this.value = "";
        } else {
          this.value = this.operator + this.semver.version;
        }
        debug("comp", this);
      }
      parse(comp) {
        const r = this.options.loose ? re[t.COMPARATORLOOSE] : re[t.COMPARATOR];
        const m = comp.match(r);
        if (!m) {
          throw new TypeError(`Invalid comparator: ${comp}`);
        }
        this.operator = m[1] !== void 0 ? m[1] : "";
        if (this.operator === "=") {
          this.operator = "";
        }
        if (!m[2]) {
          this.semver = ANY;
        } else {
          this.semver = new SemVer(m[2], this.options.loose);
        }
      }
      toString() {
        return this.value;
      }
      test(version) {
        debug("Comparator.test", version, this.options.loose);
        if (this.semver === ANY || version === ANY) {
          return true;
        }
        if (typeof version === "string") {
          try {
            version = new SemVer(version, this.options);
          } catch (er) {
            return false;
          }
        }
        return cmp(version, this.operator, this.semver, this.options);
      }
      intersects(comp, options) {
        if (!(comp instanceof _Comparator)) {
          throw new TypeError("a Comparator is required");
        }
        if (this.operator === "") {
          if (this.value === "") {
            return true;
          }
          return new Range(comp.value, options).test(this.value);
        } else if (comp.operator === "") {
          if (comp.value === "") {
            return true;
          }
          return new Range(this.value, options).test(comp.semver);
        }
        options = parseOptions(options);
        if (options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0")) {
          return false;
        }
        if (!options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0"))) {
          return false;
        }
        if (this.operator.startsWith(">") && comp.operator.startsWith(">")) {
          return true;
        }
        if (this.operator.startsWith("<") && comp.operator.startsWith("<")) {
          return true;
        }
        if (this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=")) {
          return true;
        }
        if (cmp(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<")) {
          return true;
        }
        if (cmp(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")) {
          return true;
        }
        return false;
      }
    };
    module.exports = Comparator;
    var parseOptions = require_parse_options();
    var { safeRe: re, t } = require_re();
    var cmp = require_cmp();
    var debug = require_debug();
    var SemVer = require_semver();
    var Range = require_range();
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/satisfies.js
var require_satisfies = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/satisfies.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var satisfies2 = (version, range, options) => {
      try {
        range = new Range(range, options);
      } catch (er) {
        return false;
      }
      return range.test(version);
    };
    module.exports = satisfies2;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/to-comparators.js
var require_to_comparators = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/to-comparators.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var toComparators = (range, options) => new Range(range, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
    module.exports = toComparators;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/max-satisfying.js
var require_max_satisfying = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/max-satisfying.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var maxSatisfying = (versions, range, options) => {
      let max = null;
      let maxSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!max || maxSV.compare(v) === -1) {
            max = v;
            maxSV = new SemVer(max, options);
          }
        }
      });
      return max;
    };
    module.exports = maxSatisfying;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/min-satisfying.js
var require_min_satisfying = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/min-satisfying.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var minSatisfying = (versions, range, options) => {
      let min = null;
      let minSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!min || minSV.compare(v) === 1) {
            min = v;
            minSV = new SemVer(min, options);
          }
        }
      });
      return min;
    };
    module.exports = minSatisfying;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/min-version.js
var require_min_version = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/min-version.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var gt = require_gt();
    var minVersion = (range, loose) => {
      range = new Range(range, loose);
      let minver = new SemVer("0.0.0");
      if (range.test(minver)) {
        return minver;
      }
      minver = new SemVer("0.0.0-0");
      if (range.test(minver)) {
        return minver;
      }
      minver = null;
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let setMin = null;
        comparators.forEach((comparator) => {
          const compver = new SemVer(comparator.semver.version);
          switch (comparator.operator) {
            case ">":
              if (compver.prerelease.length === 0) {
                compver.patch++;
              } else {
                compver.prerelease.push(0);
              }
              compver.raw = compver.format();
            /* fallthrough */
            case "":
            case ">=":
              if (!setMin || gt(compver, setMin)) {
                setMin = compver;
              }
              break;
            case "<":
            case "<=":
              break;
            /* istanbul ignore next */
            default:
              throw new Error(`Unexpected operation: ${comparator.operator}`);
          }
        });
        if (setMin && (!minver || gt(minver, setMin))) {
          minver = setMin;
        }
      }
      if (minver && range.test(minver)) {
        return minver;
      }
      return null;
    };
    module.exports = minVersion;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/valid.js
var require_valid2 = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/valid.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var validRange2 = (range, options) => {
      try {
        return new Range(range, options).range || "*";
      } catch (er) {
        return null;
      }
    };
    module.exports = validRange2;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/outside.js
var require_outside = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/outside.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var Range = require_range();
    var satisfies2 = require_satisfies();
    var gt = require_gt();
    var lt = require_lt();
    var lte = require_lte();
    var gte = require_gte();
    var outside = (version, range, hilo, options) => {
      version = new SemVer(version, options);
      range = new Range(range, options);
      let gtfn, ltefn, ltfn, comp, ecomp;
      switch (hilo) {
        case ">":
          gtfn = gt;
          ltefn = lte;
          ltfn = lt;
          comp = ">";
          ecomp = ">=";
          break;
        case "<":
          gtfn = lt;
          ltefn = gte;
          ltfn = gt;
          comp = "<";
          ecomp = "<=";
          break;
        default:
          throw new TypeError('Must provide a hilo val of "<" or ">"');
      }
      if (satisfies2(version, range, options)) {
        return false;
      }
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let high = null;
        let low = null;
        comparators.forEach((comparator) => {
          if (comparator.semver === ANY) {
            comparator = new Comparator(">=0.0.0");
          }
          high = high || comparator;
          low = low || comparator;
          if (gtfn(comparator.semver, high.semver, options)) {
            high = comparator;
          } else if (ltfn(comparator.semver, low.semver, options)) {
            low = comparator;
          }
        });
        if (high.operator === comp || high.operator === ecomp) {
          return false;
        }
        if ((!low.operator || low.operator === comp) && ltefn(version, low.semver)) {
          return false;
        } else if (low.operator === ecomp && ltfn(version, low.semver)) {
          return false;
        }
      }
      return true;
    };
    module.exports = outside;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/gtr.js
var require_gtr = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/gtr.js"(exports, module) {
    "use strict";
    var outside = require_outside();
    var gtr = (version, range, options) => outside(version, range, ">", options);
    module.exports = gtr;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/ltr.js
var require_ltr = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/ltr.js"(exports, module) {
    "use strict";
    var outside = require_outside();
    var ltr = (version, range, options) => outside(version, range, "<", options);
    module.exports = ltr;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/intersects.js
var require_intersects = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/intersects.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var intersects = (r1, r2, options) => {
      r1 = new Range(r1, options);
      r2 = new Range(r2, options);
      return r1.intersects(r2, options);
    };
    module.exports = intersects;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/simplify.js
var require_simplify = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/simplify.js"(exports, module) {
    "use strict";
    var satisfies2 = require_satisfies();
    var compare = require_compare();
    module.exports = (versions, range, options) => {
      const set = [];
      let first = null;
      let prev = null;
      const v = versions.sort((a, b) => compare(a, b, options));
      for (const version of v) {
        const included = satisfies2(version, range, options);
        if (included) {
          prev = version;
          if (!first) {
            first = version;
          }
        } else {
          if (prev) {
            set.push([first, prev]);
          }
          prev = null;
          first = null;
        }
      }
      if (first) {
        set.push([first, null]);
      }
      const ranges = [];
      for (const [min, max] of set) {
        if (min === max) {
          ranges.push(min);
        } else if (!max && min === v[0]) {
          ranges.push("*");
        } else if (!max) {
          ranges.push(`>=${min}`);
        } else if (min === v[0]) {
          ranges.push(`<=${max}`);
        } else {
          ranges.push(`${min} - ${max}`);
        }
      }
      const simplified = ranges.join(" || ");
      const original = typeof range.raw === "string" ? range.raw : String(range);
      return simplified.length < original.length ? simplified : range;
    };
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/subset.js
var require_subset = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/subset.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var satisfies2 = require_satisfies();
    var compare = require_compare();
    var subset = (sub, dom, options = {}) => {
      if (sub === dom) {
        return true;
      }
      sub = new Range(sub, options);
      dom = new Range(dom, options);
      let sawNonNull = false;
      OUTER: for (const simpleSub of sub.set) {
        for (const simpleDom of dom.set) {
          const isSub = simpleSubset(simpleSub, simpleDom, options);
          sawNonNull = sawNonNull || isSub !== null;
          if (isSub) {
            continue OUTER;
          }
        }
        if (sawNonNull) {
          return false;
        }
      }
      return true;
    };
    var minimumVersionWithPreRelease = [new Comparator(">=0.0.0-0")];
    var minimumVersion = [new Comparator(">=0.0.0")];
    var simpleSubset = (sub, dom, options) => {
      if (sub === dom) {
        return true;
      }
      if (sub.length === 1 && sub[0].semver === ANY) {
        if (dom.length === 1 && dom[0].semver === ANY) {
          return true;
        } else if (options.includePrerelease) {
          sub = minimumVersionWithPreRelease;
        } else {
          sub = minimumVersion;
        }
      }
      if (dom.length === 1 && dom[0].semver === ANY) {
        if (options.includePrerelease) {
          return true;
        } else {
          dom = minimumVersion;
        }
      }
      const eqSet = /* @__PURE__ */ new Set();
      let gt, lt;
      for (const c of sub) {
        if (c.operator === ">" || c.operator === ">=") {
          gt = higherGT(gt, c, options);
        } else if (c.operator === "<" || c.operator === "<=") {
          lt = lowerLT(lt, c, options);
        } else {
          eqSet.add(c.semver);
        }
      }
      if (eqSet.size > 1) {
        return null;
      }
      let gtltComp;
      if (gt && lt) {
        gtltComp = compare(gt.semver, lt.semver, options);
        if (gtltComp > 0) {
          return null;
        } else if (gtltComp === 0 && (gt.operator !== ">=" || lt.operator !== "<=")) {
          return null;
        }
      }
      for (const eq of eqSet) {
        if (gt && !satisfies2(eq, String(gt), options)) {
          return null;
        }
        if (lt && !satisfies2(eq, String(lt), options)) {
          return null;
        }
        for (const c of dom) {
          if (!satisfies2(eq, String(c), options)) {
            return false;
          }
        }
        return true;
      }
      let higher, lower;
      let hasDomLT, hasDomGT;
      let needDomLTPre = lt && !options.includePrerelease && lt.semver.prerelease.length ? lt.semver : false;
      let needDomGTPre = gt && !options.includePrerelease && gt.semver.prerelease.length ? gt.semver : false;
      if (needDomLTPre && needDomLTPre.prerelease.length === 1 && lt.operator === "<" && needDomLTPre.prerelease[0] === 0) {
        needDomLTPre = false;
      }
      for (const c of dom) {
        hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=";
        hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=";
        if (gt) {
          if (needDomGTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch) {
              needDomGTPre = false;
            }
          }
          if (c.operator === ">" || c.operator === ">=") {
            higher = higherGT(gt, c, options);
            if (higher === c && higher !== gt) {
              return false;
            }
          } else if (gt.operator === ">=" && !c.test(gt.semver)) {
            return false;
          }
        }
        if (lt) {
          if (needDomLTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch) {
              needDomLTPre = false;
            }
          }
          if (c.operator === "<" || c.operator === "<=") {
            lower = lowerLT(lt, c, options);
            if (lower === c && lower !== lt) {
              return false;
            }
          } else if (lt.operator === "<=" && !c.test(lt.semver)) {
            return false;
          }
        }
        if (!c.operator && (lt || gt) && gtltComp !== 0) {
          return false;
        }
      }
      if (gt && hasDomLT && !lt && gtltComp !== 0) {
        return false;
      }
      if (lt && hasDomGT && !gt && gtltComp !== 0) {
        return false;
      }
      if (needDomGTPre || needDomLTPre) {
        return false;
      }
      return true;
    };
    var higherGT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare(a.semver, b.semver, options);
      return comp > 0 ? a : comp < 0 ? b : b.operator === ">" && a.operator === ">=" ? b : a;
    };
    var lowerLT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare(a.semver, b.semver, options);
      return comp < 0 ? a : comp > 0 ? b : b.operator === "<" && a.operator === "<=" ? b : a;
    };
    module.exports = subset;
  }
});

// node_modules/.pnpm/semver@7.8.5/node_modules/semver/index.js
var require_semver2 = __commonJS({
  "node_modules/.pnpm/semver@7.8.5/node_modules/semver/index.js"(exports, module) {
    "use strict";
    var internalRe = require_re();
    var constants3 = require_constants();
    var SemVer = require_semver();
    var identifiers = require_identifiers();
    var parse2 = require_parse();
    var valid2 = require_valid();
    var clean = require_clean();
    var inc = require_inc();
    var diff = require_diff();
    var major = require_major();
    var minor = require_minor();
    var patch = require_patch();
    var prerelease = require_prerelease();
    var compare = require_compare();
    var rcompare2 = require_rcompare();
    var compareLoose = require_compare_loose();
    var compareBuild = require_compare_build();
    var sort = require_sort();
    var rsort = require_rsort();
    var gt = require_gt();
    var lt = require_lt();
    var eq = require_eq();
    var neq = require_neq();
    var gte = require_gte();
    var lte = require_lte();
    var cmp = require_cmp();
    var coerce = require_coerce();
    var truncate = require_truncate();
    var Comparator = require_comparator();
    var Range = require_range();
    var satisfies2 = require_satisfies();
    var toComparators = require_to_comparators();
    var maxSatisfying = require_max_satisfying();
    var minSatisfying = require_min_satisfying();
    var minVersion = require_min_version();
    var validRange2 = require_valid2();
    var outside = require_outside();
    var gtr = require_gtr();
    var ltr = require_ltr();
    var intersects = require_intersects();
    var simplifyRange = require_simplify();
    var subset = require_subset();
    module.exports = {
      parse: parse2,
      valid: valid2,
      clean,
      inc,
      diff,
      major,
      minor,
      patch,
      prerelease,
      compare,
      rcompare: rcompare2,
      compareLoose,
      compareBuild,
      sort,
      rsort,
      gt,
      lt,
      eq,
      neq,
      gte,
      lte,
      cmp,
      coerce,
      truncate,
      Comparator,
      Range,
      satisfies: satisfies2,
      toComparators,
      maxSatisfying,
      minSatisfying,
      minVersion,
      validRange: validRange2,
      outside,
      gtr,
      ltr,
      intersects,
      simplifyRange,
      subset,
      SemVer,
      re: internalRe.re,
      src: internalRe.src,
      tokens: internalRe.t,
      SEMVER_SPEC_VERSION: constants3.SEMVER_SPEC_VERSION,
      RELEASE_TYPES: constants3.RELEASE_TYPES,
      compareIdentifiers: identifiers.compareIdentifiers,
      rcompareIdentifiers: identifiers.rcompareIdentifiers
    };
  }
});

// src/server/project-preview.ts
import { constants } from "node:fs";
import { randomBytes as randomBytes2 } from "node:crypto";
import { lstat as lstat3, open as open3, realpath as realpath3 } from "node:fs/promises";
import { join as join6, relative as relative2, isAbsolute as isAbsolute2 } from "node:path";

// src/server/project-vnext-inspection.ts
import { createHash as createHash2 } from "node:crypto";
import { lstat as lstat2, open as open2, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join as join2, relative, resolve, sep } from "node:path";

// src/server/strict-json.ts
var StrictJsonFailure = class extends Error {
  constructor(code, message, jsonPath, metric, actual, limit) {
    super(message);
    this.code = code;
    this.jsonPath = jsonPath;
    this.metric = metric;
    this.actual = actual;
    this.limit = limit;
    this.name = "StrictJsonFailure";
  }
  code;
  jsonPath;
  metric;
  actual;
  limit;
};
function childPath(parent, key) {
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}
function utf8Length(codePoint) {
  if (codePoint <= 127) return 1;
  if (codePoint <= 2047) return 2;
  if (codePoint <= 65535) return 3;
  return 4;
}
function parseStrictJson(input, limits2) {
  let cursor = 0;
  let arrayItems = 0;
  let objectFields = 0;
  let nodes = 0;
  const invalid = (message, path) => {
    throw new StrictJsonFailure("PROJECT_CONTROL_FILE_INVALID_JSON", message, path);
  };
  const exceeded = (metric, actual, limit, path) => {
    throw new StrictJsonFailure(
      "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      `JSON \u7684 ${metric} \u4E3A ${actual}\uFF0C\u8D85\u8FC7\u4E0A\u9650 ${limit}\uFF1B\u8BF7\u7F29\u51CF\u8BE5\u5185\u5BB9\u540E\u91CD\u8BD5\u3002`,
      path,
      metric,
      actual,
      limit
    );
  };
  const whitespace = () => {
    while (cursor < input.length && /[\u0009\u000a\u000d\u0020]/u.test(input[cursor])) cursor += 1;
  };
  const accountNode = (path) => {
    nodes += 1;
    if (nodes > limits2.maxNodes) exceeded("nodes", nodes, limits2.maxNodes, path);
  };
  const accountString = (scalars, bytes, path) => {
    if (scalars > limits2.maxStringScalars) {
      exceeded("stringScalars", scalars, limits2.maxStringScalars, path);
    }
    if (bytes > limits2.maxStringBytes) {
      exceeded("stringBytes", bytes, limits2.maxStringBytes, path);
    }
  };
  const stringToken = (path, decode) => {
    const start = cursor;
    if (input[cursor] !== '"') invalid("JSON \u5B57\u7B26\u4E32\u7F3A\u5C11\u8D77\u59CB\u5F15\u53F7\u3002", path);
    cursor += 1;
    let scalars = 0;
    let bytes = 0;
    while (cursor < input.length) {
      const codeUnit = input.charCodeAt(cursor);
      if (codeUnit === 34) {
        cursor += 1;
        accountString(scalars, bytes, path);
        return decode ? JSON.parse(input.slice(start, cursor)) : void 0;
      }
      if (codeUnit < 32) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u672A\u8F6C\u4E49\u63A7\u5236\u5B57\u7B26\u3002", path);
      if (codeUnit === 92) {
        const escape = input[cursor + 1];
        if (escape === void 0) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u672A\u5B8C\u6210\u7684\u8F6C\u4E49\u3002", path);
        if ('"\\/bfnrt'.includes(escape)) {
          scalars += 1;
          bytes += 1;
          cursor += 2;
          accountString(scalars, bytes, path);
          continue;
        }
        if (escape !== "u") invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u975E\u6CD5\u8F6C\u4E49\u3002", path);
        const firstHex = input.slice(cursor + 2, cursor + 6);
        if (!/^[0-9a-fA-F]{4}$/u.test(firstHex)) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u975E\u6CD5 Unicode \u8F6C\u4E49\u3002", path);
        const first = Number.parseInt(firstHex, 16);
        let codePoint2 = first;
        let width2 = 6;
        if (first >= 55296 && first <= 56319) {
          if (input.slice(cursor + 6, cursor + 8) !== "\\u") {
            invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u5B64\u7ACB\u7684\u9AD8\u4F4D\u4EE3\u7406\u9879\u3002", path);
          }
          const secondHex = input.slice(cursor + 8, cursor + 12);
          if (!/^[0-9a-fA-F]{4}$/u.test(secondHex)) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u975E\u6CD5 Unicode \u8F6C\u4E49\u3002", path);
          const second = Number.parseInt(secondHex, 16);
          if (second < 56320 || second > 57343) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u5B64\u7ACB\u7684\u9AD8\u4F4D\u4EE3\u7406\u9879\u3002", path);
          codePoint2 = 65536 + (first - 55296 << 10) + second - 56320;
          width2 = 12;
        } else if (first >= 56320 && first <= 57343) {
          invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u5B64\u7ACB\u7684\u4F4E\u4F4D\u4EE3\u7406\u9879\u3002", path);
        }
        scalars += 1;
        bytes += utf8Length(codePoint2);
        cursor += width2;
        accountString(scalars, bytes, path);
        continue;
      }
      let codePoint = codeUnit;
      let width = 1;
      if (codeUnit >= 55296 && codeUnit <= 56319) {
        const second = input.charCodeAt(cursor + 1);
        if (!(second >= 56320 && second <= 57343)) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u5B64\u7ACB\u7684\u9AD8\u4F4D\u4EE3\u7406\u9879\u3002", path);
        codePoint = 65536 + (codeUnit - 55296 << 10) + second - 56320;
        width = 2;
      } else if (codeUnit >= 56320 && codeUnit <= 57343) {
        invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u5B64\u7ACB\u7684\u4F4E\u4F4D\u4EE3\u7406\u9879\u3002", path);
      }
      scalars += 1;
      bytes += utf8Length(codePoint);
      cursor += width;
      accountString(scalars, bytes, path);
    }
    return invalid("JSON \u5B57\u7B26\u4E32\u7F3A\u5C11\u7ED3\u675F\u5F15\u53F7\u3002", path);
  };
  const parseValue = (depth, path) => {
    if (depth > limits2.maxDepth) exceeded("depth", depth, limits2.maxDepth, path);
    accountNode(path);
    whitespace();
    const current = input[cursor];
    if (current === "{") {
      cursor += 1;
      whitespace();
      const keys = /* @__PURE__ */ new Set();
      if (input[cursor] === "}") {
        cursor += 1;
        return;
      }
      while (true) {
        whitespace();
        const key = stringToken(path, true);
        const valuePath = childPath(path, key);
        objectFields += 1;
        if (objectFields > limits2.maxObjectFields) {
          exceeded("objectFields", objectFields, limits2.maxObjectFields, valuePath);
        }
        if (keys.has(key)) {
          throw new StrictJsonFailure(
            "PROJECT_CONTROL_FILE_DUPLICATE_FIELD",
            `JSON \u5B57\u6BB5 ${valuePath} \u91CD\u590D\uFF1B\u8BF7\u53EA\u4FDD\u7559\u4E00\u4E2A\u5B57\u6BB5\u3002`,
            valuePath
          );
        }
        keys.add(key);
        whitespace();
        if (input[cursor] !== ":") invalid("JSON \u5BF9\u8C61\u5B57\u6BB5\u540D\u540E\u7F3A\u5C11\u5192\u53F7\u3002", valuePath);
        cursor += 1;
        parseValue(depth + 1, valuePath);
        whitespace();
        if (input[cursor] === "}") {
          cursor += 1;
          return;
        }
        if (input[cursor] !== ",") invalid("JSON \u5BF9\u8C61\u5B57\u6BB5\u4E4B\u95F4\u7F3A\u5C11\u9017\u53F7\u3002", path);
        cursor += 1;
      }
    }
    if (current === "[") {
      if (limits2.forbidArrays) exceeded("arrays", 1, 0, path);
      cursor += 1;
      whitespace();
      if (input[cursor] === "]") {
        cursor += 1;
        return;
      }
      let index = 0;
      while (true) {
        arrayItems += 1;
        if (arrayItems > limits2.maxArrayItems) {
          exceeded("arrayItems", arrayItems, limits2.maxArrayItems, `${path}[${index}]`);
        }
        parseValue(depth + 1, `${path}[${index}]`);
        index += 1;
        whitespace();
        if (input[cursor] === "]") {
          cursor += 1;
          return;
        }
        if (input[cursor] !== ",") invalid("JSON \u6570\u7EC4\u9879\u4E4B\u95F4\u7F3A\u5C11\u9017\u53F7\u3002", path);
        cursor += 1;
      }
    }
    if (current === '"') {
      stringToken(path, false);
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (input.startsWith(literal, cursor)) {
        cursor += literal.length;
        return;
      }
    }
    const number = input.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (number !== void 0) {
      if (number.length > limits2.maxNumberBytes) {
        exceeded("numberBytes", number.length, limits2.maxNumberBytes, path);
      }
      cursor += number.length;
      return;
    }
    invalid("JSON \u5305\u542B\u975E\u6CD5\u503C\u3002", path);
  };
  whitespace();
  parseValue(1, "$");
  whitespace();
  if (cursor !== input.length) invalid("JSON \u6839\u503C\u540E\u5B58\u5728\u989D\u5916\u5185\u5BB9\u3002", "$");
  return JSON.parse(input);
}

// src/server/project-speech-vnext.ts
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var DRAFT_DURATION_MS = 5e3;
var TTS_CAPABILITIES = {
  provider: "tokendance",
  models: [
    { value: "minimax-speech-2.8-turbo", label: "MiniMax Speech 2.8 Turbo" }
  ],
  voices: [
    { value: "Chinese (Mandarin)_News_Anchor", label: "\u666E\u901A\u8BDD \xB7 \u65B0\u95FB\u4E3B\u64AD" },
    { value: "Chinese (Mandarin)_Reliable_Executive", label: "\u666E\u901A\u8BDD \xB7 \u6C89\u7A33\u4E3B\u7BA1" }
  ],
  ranges: {
    speed: { min: 0.5, max: 2, step: 0.1 },
    volume: { min: 0.1, max: 10, step: 0.1 },
    pitch: { min: -12, max: 12, step: 1 }
  },
  audio: { format: "mp3", sampleRate: 32e3, bitrate: 128e3, channels: 1 }
};
var ProjectTtsConfigError = class extends Error {
  constructor(message, path, options = {}) {
    super(message, options);
    this.path = path;
    this.name = "ProjectTtsConfigError";
  }
  path;
  code = "TTS_CONFIG_INVALID";
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function inRange(value, range) {
  return typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max;
}
function validateProjectTtsConfig(value) {
  if (!isRecord(value)) throw new ProjectTtsConfigError("tts.json \u6839\u503C\u5FC5\u987B\u662F\u5BF9\u8C61\u3002", "tts.json");
  const keys = Object.keys(value).sort();
  const expected = ["model", "pitch", "provider", "speed", "voice", "volume"].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ProjectTtsConfigError("tts.json \u53EA\u80FD\u5305\u542B provider\u3001model\u3001voice\u3001speed\u3001volume \u4E0E pitch\u3002", "tts.json");
  }
  if (value.provider !== TTS_CAPABILITIES.provider) {
    throw new ProjectTtsConfigError("provider \u5FC5\u987B\u662F tokendance\u3002", "tts.json");
  }
  if (!TTS_CAPABILITIES.models.some((model) => model.value === value.model)) {
    throw new ProjectTtsConfigError("model \u4E0D\u5728\u670D\u52A1\u7AEF\u58F0\u660E\u7684\u652F\u6301\u8303\u56F4\u5185\u3002", "tts.json");
  }
  if (!TTS_CAPABILITIES.voices.some((voice) => voice.value === value.voice)) {
    throw new ProjectTtsConfigError("voice \u4E0D\u5728\u670D\u52A1\u7AEF\u58F0\u660E\u7684\u652F\u6301\u8303\u56F4\u5185\u3002", "tts.json");
  }
  if (!inRange(value.speed, TTS_CAPABILITIES.ranges.speed)) {
    throw new ProjectTtsConfigError("speed \u5FC5\u987B\u5728 0.5\u20132.0 \u4E4B\u95F4\u3002", "tts.json");
  }
  if (!inRange(value.volume, TTS_CAPABILITIES.ranges.volume)) {
    throw new ProjectTtsConfigError("volume \u5FC5\u987B\u5728 0.1\u201310.0 \u4E4B\u95F4\u3002", "tts.json");
  }
  if (!inRange(value.pitch, TTS_CAPABILITIES.ranges.pitch) || !Number.isInteger(value.pitch)) {
    throw new ProjectTtsConfigError("pitch \u5FC5\u987B\u662F -12\u201312 \u4E4B\u95F4\u7684\u6574\u6570\u3002", "tts.json");
  }
  return value;
}
function ttsProfileId(config) {
  const stable = JSON.stringify({
    provider: config.provider,
    model: config.model,
    voice: config.voice,
    speed: config.speed,
    volume: config.volume,
    pitch: config.pitch,
    audio: TTS_CAPABILITIES.audio
  });
  return `sha256:${createHash("sha256").update(stable, "utf8").digest("hex")}`;
}
async function readProjectTtsConfig(projectDirectory) {
  const path = join(projectDirectory, "tts.json");
  let bytes;
  try {
    const facts = await lstat(path);
    if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > 16 * 1024) {
      throw new ProjectTtsConfigError("tts.json \u5FC5\u987B\u662F\u5C0F\u4E8E 16 KiB \u7684\u65E0\u94FE\u63A5\u666E\u901A\u6587\u4EF6\u3002", path);
    }
    bytes = await readFile(path);
  } catch (cause) {
    if (cause instanceof ProjectTtsConfigError) throw cause;
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return { status: "unconfigured" };
    }
    throw new ProjectTtsConfigError("\u65E0\u6CD5\u5B89\u5168\u8BFB\u53D6 tts.json\u3002", path, { cause });
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ProjectTtsConfigError("tts.json \u5FC5\u987B\u662F\u4E25\u683C UTF-8\u3002", path, { cause });
  }
  let parsed;
  try {
    parsed = parseStrictJson(text, {
      maxDepth: 3,
      maxArrayItems: 0,
      maxObjectFields: 8,
      maxNodes: 16,
      maxStringScalars: 256,
      maxStringBytes: 1024,
      maxNumberBytes: 32,
      forbidArrays: true
    });
  } catch (cause) {
    throw new ProjectTtsConfigError("tts.json \u4E0D\u662F\u53D7\u652F\u6301\u7684\u4E25\u683C JSON\u3002", path, { cause });
  }
  const config = validateProjectTtsConfig(parsed);
  return { status: "configured", config, profileId: ttsProfileId(config) };
}
async function writeProjectTtsConfig(projectDirectory, input, assertWritable = async () => void 0) {
  const config = validateProjectTtsConfig(input);
  const path = join(projectDirectory, "tts.json");
  const temporaryPath = join(projectDirectory, `.tts.json.${randomUUID()}.tmp`);
  let committed = false;
  try {
    const handle = await open(temporaryPath, "wx", 384);
    try {
      await handle.writeFile(Buffer.from(JSON.stringify(config), "utf8"));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertWritable();
    await rename(temporaryPath, path);
    committed = true;
    try {
      const directory2 = await open(dirname(path), "r");
      try {
        await directory2.sync();
      } finally {
        await directory2.close();
      }
    } catch {
    }
  } finally {
    if (!committed) await rm(temporaryPath, { force: true }).catch(() => void 0);
  }
  return { status: "configured", config, profileId: ttsProfileId(config) };
}
function deriveSceneTimeWindows(scenes, fps) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("fps \u5FC5\u987B\u662F\u6B63\u6570\u3002");
  let startFrame = 0;
  let renderReady = scenes.length > 0;
  const windows = scenes.map((scene) => {
    const durationInFrames = Math.max(1, Math.ceil(scene.durationMs / 1e3 * fps));
    const window = {
      sceneId: scene.sceneId,
      startFrame,
      durationInFrames,
      source: scene.source
    };
    startFrame += durationInFrames;
    if (scene.source === "draft") renderReady = false;
    return window;
  });
  return { durationInFrames: startFrame, renderReady, scenes: windows };
}
async function probeSpeechDurationMs(path) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_name",
    "-of",
    "json",
    path
  ], { encoding: "utf8", timeout: 3e4, maxBuffer: 256 * 1024 });
  const payload = JSON.parse(stdout);
  const duration = typeof payload.format?.duration === "string" ? Number(payload.format.duration) : Number.NaN;
  if (!payload.streams?.some((stream) => stream.codec_name === "mp3") || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("Speech \u4E0D\u662F\u53EF\u89E3\u7801\u7684 MP3\u3002");
  }
  return Math.round(duration * 1e3);
}
async function speechContentHash(path) {
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const hash2 = createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      hash2.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    return `sha256:${hash2.digest("hex")}`;
  } finally {
    await handle.close();
  }
}
async function inspectProjectSpeech(projectDirectory, scenes, currentProfileId, options = {}) {
  const probe = options.probeDurationMs ?? probeSpeechDurationMs;
  const states = [];
  const durations = [];
  for (const scene of scenes) {
    const speech = scene.speech;
    if (speech === void 0) {
      states.push({ sceneId: scene.id, status: "missing", reason: "\u5F53\u524D Scene \u7F3A\u5C11 Speech\u3002" });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    const currentSourceTextHash = `sha256:${createHash("sha256").update(scene.narration.text, "utf8").digest("hex")}`;
    if (speech.sourceTextHash !== currentSourceTextHash) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "changed",
        reason: "Speech \u4E0E\u5F53\u524D Narration \u4E0D\u5339\u914D\u3002"
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    if (currentProfileId === void 0 || speech.ttsProfileId !== currentProfileId) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "profile-mismatch",
        reason: "Speech \u4E0E\u5F53\u524D TTS \u914D\u7F6E\u4E0D\u5339\u914D\u3002"
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    const absolutePath = join(projectDirectory, speech.path);
    let before;
    try {
      before = await lstat(absolutePath);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("not ordinary");
    } catch {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "unavailable",
        reason: "Speech \u6587\u4EF6\u7F3A\u5931\u3001\u4E0D\u53EF\u8BFB\u6216\u4E0D\u662F\u65E0\u94FE\u63A5\u666E\u901A\u6587\u4EF6\u3002"
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    if (speech.audioContentHash === void 0) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "changed",
        reason: "Speech \u7F3A\u5C11\u97F3\u9891\u5185\u5BB9\u6458\u8981\uFF0C\u65E0\u6CD5\u8BC1\u660E\u4ECD\u662F\u5DF2\u63D0\u4EA4\u7684\u97F3\u9891\u3002"
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    let actualDurationMs;
    let actualContentHash;
    try {
      [actualDurationMs, actualContentHash] = await Promise.all([
        probe(absolutePath),
        speechContentHash(absolutePath)
      ]);
    } catch {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "decode-failed",
        reason: "Speech \u6587\u4EF6\u65E0\u6CD5\u89E3\u7801\u4E3A MP3\u3002"
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    let after;
    try {
      after = await lstat(absolutePath);
    } catch {
      after = void 0;
    }
    const changedDuringProbe = after === void 0 || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs;
    if (changedDuringProbe || actualDurationMs !== speech.durationMs || actualContentHash !== speech.audioContentHash) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "changed",
        durationMs: actualDurationMs,
        reason: changedDuringProbe ? "Speech \u6587\u4EF6\u5728\u68C0\u67E5\u671F\u95F4\u53D1\u751F\u539F\u4F4D\u53D8\u5316\u3002" : actualContentHash !== speech.audioContentHash ? "Speech \u97F3\u9891\u5185\u5BB9\u4E0E\u5DF2\u63D0\u4EA4\u6458\u8981\u4E0D\u4E00\u81F4\u3002" : `Speech \u5B9E\u9645\u65F6\u957F ${actualDurationMs} ms \u4E0E\u8BB0\u5F55\u7684 ${speech.durationMs} ms \u4E0D\u4E00\u81F4\u3002`
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    states.push({
      sceneId: scene.id,
      path: speech.path,
      status: "available",
      durationMs: actualDurationMs
    });
    durations.push({ sceneId: scene.id, durationMs: actualDurationMs, source: "speech" });
  }
  const timeline = deriveSceneTimeWindows(durations, options.fps ?? 30);
  return {
    states,
    timeline: {
      ...timeline,
      renderReady: timeline.renderReady && scenes.every((scene) => scene.narration.text.trim() !== "")
    }
  };
}

// src/server/project-vnext-inspection.ts
var ProjectInspectionError = class extends Error {
  constructor(code, path, message, diagnostics = [], options) {
    super(message, options);
    this.code = code;
    this.path = path;
    this.diagnostics = diagnostics;
    this.name = "ProjectInspectionError";
  }
  code;
  path;
  diagnostics;
};
function invalidControlFile(path, diagnostic, options) {
  return new ProjectInspectionError(
    "PROJECT_CONTENT_INVALID",
    path,
    diagnostic.message,
    [diagnostic],
    options
  );
}
function invalidContent(path, diagnostics) {
  const first = diagnostics[0];
  return new ProjectInspectionError(
    "PROJECT_CONTENT_INVALID",
    path,
    first?.message ?? "Project VNext \u5185\u5BB9\u65E0\u6548\uFF1B\u8BF7\u4FEE\u590D\u62A5\u544A\u7684\u95EE\u9898\u540E\u91CD\u8BD5\u3002",
    diagnostics
  );
}
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function compareStableText(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function jsonPropertyPath(parent, key) {
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}
function validateProjectManifest(manifest) {
  const diagnostics = [];
  for (const key of Object.keys(manifest)) {
    if (!["kind", "formatVersion", "projectId"].includes(key)) {
      diagnostics.push({
        code: "PROJECT_MANIFEST_SCHEMA_INVALID",
        component: "narracut.json",
        jsonPath: jsonPropertyPath("$", key),
        message: `narracut.json \u5305\u542B\u672A\u77E5\u5B57\u6BB5 ${key}\uFF1B\u8BF7\u5220\u9664\u8BE5\u5B57\u6BB5\u3002`
      });
    }
  }
  if (!Number.isInteger(manifest.formatVersion)) {
    diagnostics.push({
      code: "PROJECT_MANIFEST_SCHEMA_INVALID",
      component: "narracut.json",
      jsonPath: "$.formatVersion",
      message: "formatVersion \u5FC5\u987B\u662F\u6574\u6570 1\uFF1B\u8BF7\u4FEE\u6B63\u9879\u76EE\u6E05\u5355\u3002"
    });
  }
  if (typeof manifest.projectId !== "string" || !UUID_PATTERN.test(manifest.projectId)) {
    diagnostics.push({
      code: "PROJECT_MANIFEST_SCHEMA_INVALID",
      component: "narracut.json",
      jsonPath: "$.projectId",
      message: "projectId \u5FC5\u987B\u662F\u89C4\u8303\u7684\u5C0F\u5199 UUID\uFF1B\u8BF7\u4F7F\u7528\u6709\u6548\u9879\u76EE\u6E05\u5355\u3002"
    });
  }
  return diagnostics.sort((left, right) => compareStableText(
    `${left.jsonPath}${left.code}`,
    `${right.jsonPath}${right.code}`
  ));
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function schemaDiagnostic(code, jsonPath, message) {
  return { code, component: "project.json", jsonPath, message };
}
function unknownFields(value, allowed, jsonPath, diagnostics) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      diagnostics.push(schemaDiagnostic(
        "PROJECT_DSL_SCHEMA_INVALID",
        jsonPropertyPath(jsonPath, key),
        `${jsonPath} \u5305\u542B\u672A\u77E5\u5B57\u6BB5 ${key}\uFF1B\u8BF7\u5220\u9664\u8BE5\u5B57\u6BB5\u3002`
      ));
    }
  }
}
function isCanonicalResourcePath(value, root) {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\") || value.includes("\0") || [...value].length > 1024 || Buffer.byteLength(value, "utf8") > 1024) return false;
  const parts = value.split("/");
  return parts[0] === root && parts.length > 1 && parts.every((part) => part !== "" && part !== "." && part !== "..");
}
function boundedDiagnostics(diagnostics) {
  const unique = /* @__PURE__ */ new Map();
  for (const diagnostic of diagnostics) {
    const identity2 = `${diagnostic.jsonPath ?? ""}${diagnostic.code}${diagnostic.message}`;
    if (!unique.has(identity2)) unique.set(identity2, diagnostic);
  }
  const sorted = [...unique.values()].sort((left, right) => compareStableText(
    `${left.jsonPath ?? ""}${left.code}`,
    `${right.jsonPath ?? ""}${right.code}`
  ));
  if (sorted.length <= 100) return sorted;
  return [
    ...sorted.slice(0, 99),
    {
      code: "DIAGNOSTICS_TRUNCATED",
      component: "project.json",
      message: `\u9879\u76EE\u8FD8\u6709 ${sorted.length - 99} \u6761\u95EE\u9898\u672A\u5C55\u793A\uFF1B\u8BF7\u5148\u4FEE\u590D\u5DF2\u5217\u95EE\u9898\u540E\u91CD\u65B0\u68C0\u67E5\u3002`,
      metric: "diagnostics",
      actual: sorted.length,
      limit: 100
    }
  ];
}
function validateProjectDsl(value) {
  const diagnostics = [];
  if (!isRecord2(value)) {
    return {
      diagnostics: [schemaDiagnostic(
        "PROJECT_DSL_SCHEMA_INVALID",
        "$",
        "project.json \u6839\u503C\u5FC5\u987B\u662F\u5BF9\u8C61\uFF1B\u8BF7\u63D0\u4F9B assets \u4E0E scenes\u3002"
      )]
    };
  }
  unknownFields(value, ["assets", "scenes"], "$", diagnostics);
  const assets = value.assets;
  const scenes = value.scenes;
  if (!Array.isArray(assets)) {
    diagnostics.push(schemaDiagnostic(
      "PROJECT_DSL_SCHEMA_INVALID",
      "$.assets",
      "assets \u5FC5\u987B\u662F\u6570\u7EC4\uFF1B\u8BF7\u4FEE\u6B63 Project DSL\u3002"
    ));
  }
  if (!Array.isArray(scenes)) {
    diagnostics.push(schemaDiagnostic(
      "PROJECT_DSL_SCHEMA_INVALID",
      "$.scenes",
      "scenes \u5FC5\u987B\u662F\u6570\u7EC4\uFF1B\u8BF7\u4FEE\u6B63 Project DSL\u3002"
    ));
  }
  if (!Array.isArray(assets) || !Array.isArray(scenes)) {
    return { diagnostics: boundedDiagnostics(diagnostics) };
  }
  if (assets.length > 1e3) {
    return { diagnostics: [{
      code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      component: "project.json",
      jsonPath: "$.assets[1000]",
      message: `assets \u6709 ${assets.length} \u9879\uFF0C\u8D85\u8FC7\u4E0A\u9650 1000\uFF1B\u8BF7\u79FB\u9664\u591A\u4F59 Asset\u3002`,
      metric: "assets",
      actual: assets.length,
      limit: 1e3
    }] };
  }
  if (scenes.length > 1e3) {
    return { diagnostics: [{
      code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      component: "project.json",
      jsonPath: "$.scenes[1000]",
      message: `scenes \u6709 ${scenes.length} \u9879\uFF0C\u8D85\u8FC7\u4E0A\u9650 1000\uFF1B\u8BF7\u79FB\u9664\u591A\u4F59 Scene\u3002`,
      metric: "scenes",
      actual: scenes.length,
      limit: 1e3
    }] };
  }
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    if (isRecord2(asset) && typeof asset.path === "string") {
      const bytes = Buffer.byteLength(asset.path, "utf8");
      const scalars = [...asset.path].length;
      if (bytes > 1024) {
        return { diagnostics: [{
          code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
          component: "project.json",
          jsonPath: `$.assets[${index}].path`,
          message: `Asset path \u4E3A ${bytes} UTF-8 \u5B57\u8282\uFF0C\u8D85\u8FC7\u4E0A\u9650 1024\uFF1B\u8BF7\u7F29\u77ED\u8DEF\u5F84\u3002`,
          metric: "pathBytes",
          actual: bytes,
          limit: 1024
        }] };
      }
      if (scalars > 1024) {
        return { diagnostics: [{
          code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
          component: "project.json",
          jsonPath: `$.assets[${index}].path`,
          message: `Asset path \u6709 ${scalars} \u4E2A Unicode \u6807\u91CF\uFF0C\u8D85\u8FC7\u4E0A\u9650 1024\uFF1B\u8BF7\u7F29\u77ED\u8DEF\u5F84\u3002`,
          metric: "pathScalars",
          actual: scalars,
          limit: 1024
        }] };
      }
    }
  }
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (!isRecord2(scene)) continue;
    if (Array.isArray(scene.assetIds) && scene.assetIds.length > 256) {
      return { diagnostics: [{
        code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
        component: "project.json",
        jsonPath: `$.scenes[${index}].assetIds[256]`,
        message: `Scene \u7684 assetIds \u6709 ${scene.assetIds.length} \u9879\uFF0C\u8D85\u8FC7\u4E0A\u9650 256\uFF1B\u8BF7\u79FB\u9664\u591A\u4F59\u5F15\u7528\u3002`,
        metric: "sceneAssetIds",
        actual: scene.assetIds.length,
        limit: 256
      }] };
    }
    if (isRecord2(scene.speech)) {
      if (typeof scene.speech.path === "string") {
        const bytes = Buffer.byteLength(scene.speech.path, "utf8");
        const scalars = [...scene.speech.path].length;
        if (bytes > 1024 || scalars > 1024) {
          const metric = bytes > 1024 ? "pathBytes" : "pathScalars";
          const actual = bytes > 1024 ? bytes : scalars;
          return { diagnostics: [{
            code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
            component: "project.json",
            jsonPath: `$.scenes[${index}].speech.path`,
            message: `Speech path \u7684 ${metric} \u4E3A ${actual}\uFF0C\u8D85\u8FC7\u4E0A\u9650 1024\uFF1B\u8BF7\u7F29\u77ED\u8DEF\u5F84\u3002`,
            metric,
            actual,
            limit: 1024
          }] };
        }
      }
      if (typeof scene.speech.ttsProfileId === "string" && [...scene.speech.ttsProfileId].length > 256) {
        const actual = [...scene.speech.ttsProfileId].length;
        return { diagnostics: [{
          code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
          component: "project.json",
          jsonPath: `$.scenes[${index}].speech.ttsProfileId`,
          message: `ttsProfileId \u6709 ${actual} \u4E2A Unicode \u6807\u91CF\uFF0C\u8D85\u8FC7\u4E0A\u9650 256\uFF1B\u8BF7\u7F29\u77ED\u8BE5\u6807\u8BC6\u3002`,
          metric: "ttsProfileIdScalars",
          actual,
          limit: 256
        }] };
      }
    }
  }
  const assetIds = /* @__PURE__ */ new Set();
  const assetPaths = /* @__PURE__ */ new Set();
  assets.forEach((asset, index) => {
    const path = `$.assets[${index}]`;
    if (!isRecord2(asset)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", path, `${path} \u5FC5\u987B\u662F Asset \u5BF9\u8C61\u3002`));
      return;
    }
    unknownFields(asset, ["id", "path"], path, diagnostics);
    if (typeof asset.id !== "string" || !UUID_PATTERN.test(asset.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.id`, "Asset id \u5FC5\u987B\u662F\u89C4\u8303\u7684\u5C0F\u5199 UUID\u3002"));
    } else if (assetIds.has(asset.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_ID_DUPLICATE", `${path}.id`, `Asset id ${asset.id} \u91CD\u590D\uFF1B\u8BF7\u4E3A\u6BCF\u4E2A Asset \u4F7F\u7528\u552F\u4E00 ID\u3002`));
    } else {
      assetIds.add(asset.id);
    }
    if (typeof asset.path !== "string" || !isCanonicalResourcePath(asset.path, "assets")) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_PATH_INVALID", `${path}.path`, "Asset path \u5FC5\u987B\u662F assets/ \u4E0B\u7684\u89C4\u8303\u9879\u76EE\u76F8\u5BF9\u8DEF\u5F84\u3002"));
    } else if (assetPaths.has(asset.path)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_PATH_DUPLICATE", `${path}.path`, `Asset path ${asset.path} \u91CD\u590D\uFF1B\u8BF7\u4F7F\u7528\u552F\u4E00\u8DEF\u5F84\u3002`));
    } else {
      assetPaths.add(asset.path);
    }
  });
  const sceneIds = /* @__PURE__ */ new Set();
  scenes.forEach((scene, index) => {
    const path = `$.scenes[${index}]`;
    if (!isRecord2(scene)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", path, `${path} \u5FC5\u987B\u662F Scene \u5BF9\u8C61\u3002`));
      return;
    }
    unknownFields(scene, ["id", "narration", "assetIds", "speech"], path, diagnostics);
    if (typeof scene.id !== "string" || !UUID_PATTERN.test(scene.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.id`, "Scene id \u5FC5\u987B\u662F\u89C4\u8303\u7684\u5C0F\u5199 UUID\u3002"));
    } else if (sceneIds.has(scene.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_ID_DUPLICATE", `${path}.id`, `Scene id ${scene.id} \u91CD\u590D\uFF1B\u8BF7\u4E3A\u6BCF\u4E2A Scene \u4F7F\u7528\u552F\u4E00 ID\u3002`));
    } else {
      sceneIds.add(scene.id);
    }
    if (!isRecord2(scene.narration)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.narration`, "narration \u5FC5\u987B\u662F\u53EA\u542B text \u7684\u5BF9\u8C61\u3002"));
    } else {
      unknownFields(scene.narration, ["text"], `${path}.narration`, diagnostics);
      if (typeof scene.narration.text !== "string") {
        diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.narration.text`, "Narration text \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u3002"));
      }
    }
    if (!Array.isArray(scene.assetIds)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.assetIds`, "assetIds \u5FC5\u987B\u662F UUID \u6570\u7EC4\u3002"));
    } else {
      const references = /* @__PURE__ */ new Set();
      scene.assetIds.forEach((assetId, assetIndex) => {
        const referencePath = `${path}.assetIds[${assetIndex}]`;
        if (typeof assetId !== "string" || !UUID_PATTERN.test(assetId)) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", referencePath, "Asset \u5F15\u7528\u5FC5\u987B\u662F\u89C4\u8303\u7684\u5C0F\u5199 UUID\u3002"));
        } else if (references.has(assetId)) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_REFERENCE_DUPLICATE", referencePath, `Scene \u91CD\u590D\u5F15\u7528 Asset ${assetId}\uFF1B\u8BF7\u79FB\u9664\u91CD\u590D\u9879\u3002`));
        } else {
          references.add(assetId);
          if (!assetIds.has(assetId)) {
            diagnostics.push(schemaDiagnostic("PROJECT_DSL_REFERENCE_INVALID", referencePath, `Asset \u5F15\u7528 ${assetId} \u672A\u5728 assets \u4E2D\u767B\u8BB0\uFF1B\u8BF7\u767B\u8BB0\u6216\u79FB\u9664\u8BE5\u5F15\u7528\u3002`));
          }
        }
      });
    }
    if ("speech" in scene) {
      if (!isRecord2(scene.speech)) {
        diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech`, "speech \u7F3A\u7701\u65F6\u5FC5\u987B\u7701\u7565\u5B57\u6BB5\uFF0C\u5B58\u5728\u65F6\u5FC5\u987B\u662F\u5B8C\u6574\u5BF9\u8C61\u3002"));
      } else {
        unknownFields(scene.speech, ["path", "durationMs", "sourceTextHash", "ttsProfileId", "audioContentHash"], `${path}.speech`, diagnostics);
        const expectedPath = typeof scene.id === "string" ? `speech/${scene.id}.mp3` : void 0;
        if (typeof scene.speech.path !== "string" || !isCanonicalResourcePath(scene.speech.path, "speech") || scene.speech.path !== expectedPath) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_PATH_INVALID", `${path}.speech.path`, `Speech path \u5FC5\u987B\u7CBE\u786E\u4E3A ${expectedPath ?? "speech/<sceneId>.mp3"}\u3002`));
        }
        if (!Number.isSafeInteger(scene.speech.durationMs) || scene.speech.durationMs <= 0) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.durationMs`, "durationMs \u5FC5\u987B\u662F\u6B63\u5B89\u5168\u6574\u6570\u3002"));
        }
        const narrationText = isRecord2(scene.narration) && typeof scene.narration.text === "string" ? scene.narration.text : void 0;
        const expectedHash = narrationText === void 0 ? void 0 : `sha256:${createHash2("sha256").update(narrationText, "utf8").digest("hex")}`;
        if (typeof scene.speech.sourceTextHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(scene.speech.sourceTextHash) || expectedHash !== void 0 && scene.speech.sourceTextHash !== expectedHash) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SPEECH_MISMATCH", `${path}.speech.sourceTextHash`, "sourceTextHash \u5FC5\u987B\u5339\u914D\u5F53\u524D Narration \u7684\u539F\u59CB UTF-8 \u5B57\u8282\u3002"));
        }
        if (typeof scene.speech.ttsProfileId !== "string") {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.ttsProfileId`, "ttsProfileId \u5FC5\u987B\u662F\u4E0D\u8D85\u8FC7 256 \u4E2A Unicode \u6807\u91CF\u7684\u5B57\u7B26\u4E32\u3002"));
        }
        if ("audioContentHash" in scene.speech && (typeof scene.speech.audioContentHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(scene.speech.audioContentHash))) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.audioContentHash`, "audioContentHash \u5FC5\u987B\u662F\u89C4\u8303\u7684 SHA-256 \u6458\u8981\u3002"));
        }
      }
    }
  });
  return {
    ...diagnostics.length === 0 ? { project: value } : {},
    diagnostics: boundedDiagnostics(diagnostics)
  };
}
function validateProjectVNextForSave(value, projectPath = "project.json") {
  let inputBytes;
  try {
    inputBytes = Buffer.from(JSON.stringify(value), "utf8");
  } catch (cause) {
    throw invalidControlFile(projectPath, {
      code: "PROJECT_DSL_SCHEMA_INVALID",
      component: "project.json",
      jsonPath: "$",
      message: "Project DSL \u5FC5\u987B\u662F\u53EF\u5E8F\u5217\u5316\u7684 JSON \u5BF9\u8C61\u3002"
    }, { cause });
  }
  if (inputBytes.length > 10 * 1024 * 1024) {
    throw invalidControlFile(projectPath, {
      code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      component: "project.json",
      message: `project.json \u4E3A ${inputBytes.length} \u5B57\u8282\uFF0C\u8D85\u8FC7\u4E0A\u9650 ${10 * 1024 * 1024}\uFF1B\u8BF7\u7F29\u51CF\u5185\u5BB9\u540E\u91CD\u8BD5\u3002`,
      metric: "bytes",
      actual: inputBytes.length,
      limit: 10 * 1024 * 1024
    });
  }
  const parsed = parseControlJson(
    inputBytes.toString("utf8"),
    projectPath,
    "project.json",
    PROJECT_JSON_LIMITS
  );
  const validation = validateProjectDsl(parsed);
  if (validation.project === void 0) {
    throw invalidContent(projectPath, validation.diagnostics);
  }
  const project = validation.project;
  const bytes = Buffer.from(JSON.stringify({
    assets: project.assets.map((asset) => ({ id: asset.id, path: asset.path })),
    scenes: project.scenes.map((scene) => ({
      id: scene.id,
      narration: { text: scene.narration.text },
      assetIds: [...scene.assetIds],
      ...scene.speech === void 0 ? {} : {
        speech: {
          path: scene.speech.path,
          durationMs: scene.speech.durationMs,
          sourceTextHash: scene.speech.sourceTextHash,
          ttsProfileId: scene.speech.ttsProfileId,
          ...scene.speech.audioContentHash === void 0 ? {} : { audioContentHash: scene.speech.audioContentHash }
        }
      }
    }))
  }), "utf8");
  return { project, bytes };
}
function decodeUtf8(bytes, path, component, allowBom) {
  if (!allowBom && bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    throw invalidControlFile(path, {
      code: "PROJECT_CONTROL_FILE_INVALID_UTF8",
      component,
      message: `${component} \u4E0D\u5F97\u5305\u542B UTF-8 BOM\uFF1B\u8BF7\u79FB\u9664 BOM \u540E\u91CD\u8BD5\u3002`
    });
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: allowBom }).decode(bytes);
  } catch (cause) {
    throw invalidControlFile(path, {
      code: "PROJECT_CONTROL_FILE_INVALID_UTF8",
      component,
      message: `${component} \u4E0D\u662F\u4E25\u683C UTF-8\uFF1B\u8BF7\u4EE5 UTF-8 \u91CD\u65B0\u4FDD\u5B58\u540E\u91CD\u8BD5\u3002`
    }, { cause });
  }
}
var MANIFEST_JSON_LIMITS = {
  maxDepth: 4,
  maxArrayItems: 0,
  maxObjectFields: 16,
  maxNodes: 32,
  maxStringScalars: 256,
  maxStringBytes: 1024,
  maxNumberBytes: 64,
  forbidArrays: true
};
var PROJECT_JSON_LIMITS = {
  maxDepth: 8,
  maxArrayItems: 1e5,
  maxObjectFields: 32e3,
  maxNodes: 2e5,
  maxStringScalars: 65536,
  maxStringBytes: 256 * 1024,
  maxNumberBytes: 64
};
function parseControlJson(input, path, component, limits2) {
  try {
    return parseStrictJson(input, limits2);
  } catch (cause) {
    if (!(cause instanceof StrictJsonFailure)) throw cause;
    throw invalidControlFile(path, {
      code: cause.code,
      component,
      message: cause.message,
      jsonPath: cause.jsonPath,
      ...cause.metric === void 0 ? {} : { metric: cause.metric },
      ...cause.actual === void 0 ? {} : { actual: cause.actual },
      ...cause.limit === void 0 ? {} : { limit: cause.limit }
    }, { cause });
  }
}
async function readBoundedControlFile(path, component, limit) {
  const pathFacts = await lstat2(path);
  if (!pathFacts.isFile() || pathFacts.isSymbolicLink() || pathFacts.nlink !== 1) {
    throw invalidControlFile(path, {
      code: "PROJECT_REQUIRED_CONTENT_INVALID",
      component,
      message: `${component} \u5FC5\u987B\u662F\u65E0\u7B26\u53F7\u94FE\u63A5\u3001\u65E0\u786C\u94FE\u63A5\u7684\u666E\u901A\u6587\u4EF6\uFF1B\u8BF7\u66FF\u6362\u8BE5\u8DEF\u5F84\u540E\u91CD\u8BD5\u3002`
    });
  }
  const handle = await open2(path, "r");
  try {
    const facts = await handle.stat();
    if (!facts.isFile() || facts.dev !== pathFacts.dev || facts.ino !== pathFacts.ino) {
      throw invalidControlFile(path, {
        code: "PROJECT_REQUIRED_CONTENT_INVALID",
        component,
        message: `${component} \u5728\u68C0\u67E5\u671F\u95F4\u88AB\u66FF\u6362\uFF1B\u8BF7\u505C\u6B62\u5916\u90E8\u4FEE\u6539\u540E\u91CD\u8BD5\u3002`
      });
    }
    if (facts.size > limit) {
      throw invalidControlFile(path, {
        code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
        component,
        message: `${component} \u4E3A ${facts.size} \u5B57\u8282\uFF0C\u8D85\u8FC7\u4E0A\u9650 ${limit}\uFF1B\u8BF7\u7F29\u51CF\u6587\u4EF6\u540E\u91CD\u8BD5\u3002`,
        metric: "bytes",
        actual: facts.size,
        limit
      });
    }
    const bytes = Buffer.allocUnsafe(limit + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > limit) {
      throw invalidControlFile(path, {
        code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
        component,
        message: `${component} \u5728\u8BFB\u53D6\u671F\u95F4\u8D85\u8FC7 ${limit} \u5B57\u8282\uFF1B\u8BF7\u505C\u6B62\u5916\u90E8\u4FEE\u6539\u5E76\u7F29\u51CF\u6587\u4EF6\u540E\u91CD\u8BD5\u3002`,
        metric: "bytes",
        actual: total,
        limit
      });
    }
    return bytes.subarray(0, total);
  } finally {
    await handle.close();
  }
}
async function readProjectVNextRevision(projectPath) {
  const bytes = await readBoundedControlFile(projectPath, "project.json", 10 * 1024 * 1024);
  return `sha256:${createHash2("sha256").update(bytes).digest("hex")}`;
}
async function readVideoBriefVNext(videoBriefPath) {
  const buffer = await readBoundedControlFile(videoBriefPath, "video.md", 2 * 1024 * 1024);
  return {
    content: decodeUtf8(buffer, videoBriefPath, "video.md", true),
    revision: `sha256:${createHash2("sha256").update(buffer).digest("hex")}`,
    bytes: buffer.length
  };
}
async function requireDirectory(path) {
  const facts = await lstat2(path);
  if (!facts.isDirectory() || facts.isSymbolicLink()) throw new Error(`\u5FC5\u9700\u76EE\u5F55\u65E0\u6548\uFF1A${path}`);
}
async function requireFile(path) {
  const facts = await lstat2(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1) {
    throw new Error(`\u5FC5\u9700\u6587\u4EF6\u65E0\u6548\uFF1A${path}`);
  }
}
function isFileSystemError(error) {
  return error instanceof Error && "code" in error;
}
function missingContent(path, component) {
  return invalidContent(path, [{
    code: "PROJECT_REQUIRED_CONTENT_MISSING",
    component,
    message: `\u7F3A\u5C11\u5FC5\u9700\u7684 ${component}\uFF1B\u8BF7\u6062\u590D\u5B8C\u6574 Project VNext \u5185\u5BB9\u540E\u91CD\u8BD5\u3002`
  }]);
}
function invalidResource(path, component, message) {
  return invalidContent(path, [{ code: "PROJECT_RESOURCE_INVALID", component, message }]);
}
async function validateOrdinaryResource(projectDirectory, relativePath, required) {
  const parts = relativePath.split("/");
  const directoryIdentities = [];
  for (let index = 0; index < parts.length; index += 1) {
    const component = parts.slice(0, index + 1).join("/");
    const path = join2(projectDirectory, component);
    let facts;
    try {
      facts = await lstat2(path);
    } catch (cause) {
      if (isFileSystemError(cause) && cause.code === "ENOENT" && !required) return;
      if (isFileSystemError(cause) && cause.code === "ENOENT") {
        throw missingContent(path, component);
      }
      throw new ProjectInspectionError(
        "PROJECT_PATH_UNAVAILABLE",
        path,
        `\u65E0\u6CD5\u68C0\u67E5\u8D44\u6E90 ${path}\uFF1B\u8BF7\u68C0\u67E5\u8DEF\u5F84\u548C\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
        [],
        { cause }
      );
    }
    const isLeaf = index === parts.length - 1;
    if (!isLeaf && (!facts.isDirectory() || facts.isSymbolicLink())) {
      throw invalidResource(
        path,
        component,
        `${component} \u5FC5\u987B\u662F\u65E0\u7B26\u53F7\u94FE\u63A5\u7684\u666E\u901A\u76EE\u5F55\uFF1B\u8BF7\u66FF\u6362\u8BE5\u8DEF\u5F84\u3002`
      );
    }
    if (!isLeaf) directoryIdentities.push({ path, dev: facts.dev, ino: facts.ino });
    if (isLeaf && (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1)) {
      throw invalidResource(
        path,
        relativePath,
        `${relativePath} \u5FC5\u987B\u662F\u65E0\u7B26\u53F7\u94FE\u63A5\u3001\u65E0\u786C\u94FE\u63A5\u7684\u666E\u901A\u6587\u4EF6\uFF1B\u8BF7\u66FF\u6362\u8BE5\u8D44\u6E90\u3002`
      );
    }
  }
  const resourcePath = join2(projectDirectory, relativePath);
  const allowedRoot = await realpath(join2(projectDirectory, parts[0]));
  const resolvedResource = await realpath(resourcePath);
  const relation = relative(allowedRoot, resolvedResource);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw invalidResource(
      resourcePath,
      relativePath,
      `${relativePath} \u89E3\u6790\u5230 ${allowedRoot} \u4E4B\u5916\uFF1B\u8BF7\u79FB\u9664\u8DEF\u5F84\u4E2D\u7684\u94FE\u63A5\u3002`
    );
  }
  for (const identity2 of directoryIdentities) {
    const current = await lstat2(identity2.path);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity2.dev || current.ino !== identity2.ino) {
      throw invalidResource(
        identity2.path,
        relative(projectDirectory, identity2.path),
        `${relative(projectDirectory, identity2.path)} \u5728\u68C0\u67E5\u671F\u95F4\u88AB\u66FF\u6362\uFF1B\u8BF7\u505C\u6B62\u5916\u90E8\u4FEE\u6539\u540E\u91CD\u8BD5\u3002`
      );
    }
  }
}
async function validateProjectVNextResources(projectDirectory, project, options = {}) {
  const assetStates = [];
  for (const asset of project.assets) {
    const path = join2(projectDirectory, asset.path);
    await validateOrdinaryResource(projectDirectory, asset.path, false);
    let facts;
    try {
      facts = await lstat2(path);
    } catch (cause) {
      assetStates.push({
        id: asset.id,
        path: asset.path,
        status: "unavailable",
        reason: isFileSystemError(cause) && cause.code === "ENOENT" ? "\u6587\u4EF6\u7F3A\u5931\u6216\u5DF2\u88AB\u79FB\u52A8\u3002" : "\u6587\u4EF6\u65E0\u6CD5\u8BFB\u53D6\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u6216\u8BBE\u5907\u72B6\u6001\u3002"
      });
      continue;
    }
    try {
      const handle = await open2(path, "r");
      await handle.close();
      assetStates.push({
        id: asset.id,
        path: asset.path,
        status: "available",
        size: facts.size
      });
    } catch {
      assetStates.push({
        id: asset.id,
        path: asset.path,
        status: "unavailable",
        reason: "\u6587\u4EF6\u65E0\u6CD5\u8BFB\u53D6\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u6216\u8BBE\u5907\u72B6\u6001\u3002"
      });
    }
  }
  const speech = await inspectProjectSpeech(
    projectDirectory,
    project.scenes,
    options.currentTtsProfileId,
    { probeDurationMs: options.probeSpeechDurationMs }
  );
  const speechWarnings = speech.states.filter((state) => state.status !== "available" && state.status !== "missing").map((state, index) => {
    const sceneIndex = project.scenes.findIndex((scene) => scene.id === state.sceneId);
    const code = {
      available: "",
      missing: "PROJECT_SPEECH_MISSING",
      unavailable: "PROJECT_SPEECH_UNAVAILABLE",
      "decode-failed": "PROJECT_SPEECH_DECODE_FAILED",
      changed: "PROJECT_SPEECH_CHANGED",
      "profile-mismatch": "PROJECT_SPEECH_PROFILE_MISMATCH"
    }[state.status];
    return {
      code: code ?? "PROJECT_SPEECH_UNAVAILABLE",
      component: state.path ?? `Scene ${sceneIndex + 1}`,
      jsonPath: `$.scenes[${sceneIndex < 0 ? index : sceneIndex}].speech`,
      message: state.reason ?? "Speech \u5F53\u524D\u4E0D\u53EF\u7528\u4E8E\u6B63\u5F0F Render\u3002"
    };
  });
  return {
    assetStates,
    speechStates: speech.states,
    timeline: speech.timeline,
    warnings: boundedDiagnostics([...assetStates.filter((asset) => asset.status === "unavailable").map((asset) => ({
      code: "PROJECT_ASSET_UNAVAILABLE",
      component: asset.path,
      message: `${asset.path} \u4E0D\u53EF\u7528\uFF1A${asset.reason ?? "\u65E0\u6CD5\u8BFB\u53D6\u3002"}`
    })), ...speechWarnings])
  };
}
async function readStableDirectory(directory2) {
  const entries = await readdir(directory2, { withFileTypes: true });
  entries.sort((left, right) => compareStableText(left.name, right.name));
  return entries;
}
var MAX_DIRECTORY_TREE_DEPTH = 32;
var MAX_DIRECTORY_TREE_DIRECTORIES = 4096;
function directoryTreeLimit(projectDirectory, path, metric, actual, limit) {
  const component = relative(projectDirectory, path) || ".";
  return invalidControlFile(path, {
    code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
    component,
    metric,
    actual,
    limit,
    message: `${component} \u7684${metric === "directoryDepth" ? "\u76EE\u5F55\u6DF1\u5EA6" : "\u5DF2\u68C0\u67E5\u76EE\u5F55\u6570"}\u4E3A ${actual}\uFF0C\u8D85\u8FC7\u4E0A\u9650 ${limit}\uFF1B\u8BF7\u7CBE\u7B80\u9879\u76EE\u5185\u90E8\u6811\u540E\u91CD\u8BD5\u3002`
  });
}
async function discoverRenderProgramDirectories(projectDirectory) {
  const excludedRoots = /* @__PURE__ */ new Set(["assets", "speech", "renders"]);
  const stack = [{ directory: projectDirectory, depth: 0 }];
  const programs = [];
  let directoriesVisited = 0;
  while (stack.length > 0) {
    const { directory: directory2, depth } = stack.pop();
    directoriesVisited += 1;
    if (directoriesVisited > MAX_DIRECTORY_TREE_DIRECTORIES) {
      throw directoryTreeLimit(projectDirectory, directory2, "directories", directoriesVisited, MAX_DIRECTORY_TREE_DIRECTORIES);
    }
    let entries;
    try {
      entries = await readStableDirectory(directory2);
    } catch (cause) {
      throw new ProjectInspectionError(
        "PROJECT_PATH_UNAVAILABLE",
        directory2,
        `\u65E0\u6CD5\u68C0\u67E5\u9879\u76EE\u5185\u5BB9\u76EE\u5F55 ${directory2}\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
        [],
        { cause }
      );
    }
    for (const entry of [...entries].reverse()) {
      if (directory2 === projectDirectory && excludedRoots.has(entry.name)) continue;
      if (["node_modules", ".cache", "bundle"].includes(entry.name)) continue;
      const path = join2(directory2, entry.name);
      const facts = await lstat2(path);
      if (facts.isSymbolicLink() || !facts.isDirectory()) continue;
      const childDepth = depth + 1;
      if (childDepth > MAX_DIRECTORY_TREE_DEPTH) {
        throw directoryTreeLimit(projectDirectory, path, "directoryDepth", childDepth, MAX_DIRECTORY_TREE_DEPTH);
      }
      if (entry.name === "render-program") {
        programs.push(path);
      } else {
        stack.push({ directory: path, depth: childDepth });
      }
    }
  }
  programs.sort(compareStableText);
  return programs;
}
async function validateRenderProgramDirectory(projectDirectory, programDirectory) {
  const projectRoot = await realpath(projectDirectory);
  const resolvedProgram = await realpath(programDirectory);
  const programRelation = relative(projectRoot, resolvedProgram);
  if (programRelation === ".." || programRelation.startsWith(`..${sep}`) || isAbsolute(programRelation)) {
    throw invalidResource(
      programDirectory,
      relative(projectDirectory, programDirectory),
      "Render Program \u89E3\u6790\u5230\u9879\u76EE\u76EE\u5F55\u4E4B\u5916\uFF1B\u8BF7\u79FB\u9664\u7236\u8DEF\u5F84\u4E2D\u7684\u94FE\u63A5\u3002"
    );
  }
  const requiredEntries = [
    ["program.json", "file"],
    ["package.json", "file"],
    ["pnpm-lock.yaml", "file"],
    ["src", "directory"],
    ["src/RenderProgram.tsx", "file"],
    ["resources", "directory"]
  ];
  for (const [entry, kind] of requiredEntries) {
    const path = join2(programDirectory, ...entry.split("/"));
    let facts;
    try {
      facts = await lstat2(path);
    } catch (cause) {
      if (isFileSystemError(cause) && cause.code === "ENOENT") {
        throw missingContent(path, relative(projectDirectory, path));
      }
      throw new ProjectInspectionError(
        "PROJECT_PATH_UNAVAILABLE",
        path,
        `\u65E0\u6CD5\u68C0\u67E5 Render Program \u8DEF\u5F84 ${path}\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
        [],
        { cause }
      );
    }
    const valid2 = kind === "directory" ? facts.isDirectory() && !facts.isSymbolicLink() : facts.isFile() && !facts.isSymbolicLink() && facts.nlink === 1;
    if (!valid2) {
      throw invalidResource(
        path,
        relative(projectDirectory, path),
        `${relative(projectDirectory, path)} \u5FC5\u987B\u662F\u65E0\u94FE\u63A5\u7684\u666E\u901A${kind === "directory" ? "\u76EE\u5F55" : "\u6587\u4EF6"}\u3002`
      );
    }
  }
  const stack = [{ directory: programDirectory, depth: 0 }];
  let directoriesVisited = 0;
  while (stack.length > 0) {
    const { directory: directory2, depth } = stack.pop();
    directoriesVisited += 1;
    if (directoriesVisited > MAX_DIRECTORY_TREE_DIRECTORIES) {
      throw directoryTreeLimit(projectDirectory, directory2, "directories", directoriesVisited, MAX_DIRECTORY_TREE_DIRECTORIES);
    }
    for (const entry of [...await readStableDirectory(directory2)].reverse()) {
      const path = join2(directory2, entry.name);
      const component = relative(projectDirectory, path);
      if (["node_modules", ".cache", "bundle"].includes(entry.name)) {
        throw invalidResource(path, component, `Render Program \u4E0D\u5F97\u643A\u5E26 ${entry.name} \u6D3E\u751F\u4EA7\u7269\uFF1B\u8BF7\u5C06\u5176\u79FB\u51FA\u9879\u76EE\u3002`);
      }
      const facts = await lstat2(path);
      if (facts.isSymbolicLink()) {
        throw invalidResource(path, component, `${component} \u662F\u7B26\u53F7\u94FE\u63A5\uFF1BRender Program \u6811\u53EA\u5141\u8BB8\u666E\u901A\u6587\u4EF6\u548C\u76EE\u5F55\u3002`);
      }
      if (facts.isDirectory()) {
        const childDepth = depth + 1;
        if (childDepth > MAX_DIRECTORY_TREE_DEPTH) {
          throw directoryTreeLimit(projectDirectory, path, "directoryDepth", childDepth, MAX_DIRECTORY_TREE_DEPTH);
        }
        stack.push({ directory: path, depth: childDepth });
      } else if (!facts.isFile() || facts.nlink !== 1) {
        throw invalidResource(path, component, `${component} \u4E0D\u662F\u65E0\u786C\u94FE\u63A5\u7684\u666E\u901A\u6587\u4EF6\uFF1B\u8BF7\u66FF\u6362\u8BE5\u8D44\u6E90\u3002`);
      }
    }
  }
  if (await realpath(programDirectory) !== resolvedProgram) {
    throw invalidResource(
      programDirectory,
      relative(projectDirectory, programDirectory),
      "Render Program \u5728\u68C0\u67E5\u671F\u95F4\u88AB\u66FF\u6362\uFF1B\u8BF7\u505C\u6B62\u5916\u90E8\u4FEE\u6539\u540E\u91CD\u8BD5\u3002"
    );
  }
}
async function inspectProjectVNext(inputPath, options = {}) {
  const projectDirectory = resolve(inputPath);
  try {
    await requireDirectory(projectDirectory);
  } catch (cause) {
    throw new ProjectInspectionError(
      "PROJECT_PATH_UNAVAILABLE",
      projectDirectory,
      `\u65E0\u6CD5\u8BFB\u53D6\u9879\u76EE\u76EE\u5F55 ${projectDirectory}\uFF1B\u8BF7\u68C0\u67E5\u8DEF\u5F84\u548C\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
      [],
      { cause }
    );
  }
  const manifestPath = join2(projectDirectory, "narracut.json");
  let manifestBuffer;
  try {
    manifestBuffer = await readBoundedControlFile(manifestPath, "narracut.json", 4 * 1024);
  } catch (cause) {
    if (cause instanceof ProjectInspectionError) throw cause;
    if (isFileSystemError(cause) && cause.code === "ENOENT") {
      throw new ProjectInspectionError(
        "NOT_A_NARRACUT_PROJECT",
        manifestPath,
        `\u76EE\u5F55\u4E2D\u6CA1\u6709 narracut.json\uFF1B\u8BF7\u9009\u62E9 Project VNext \u9879\u76EE\u76EE\u5F55\u3002`,
        [],
        { cause }
      );
    }
    throw new ProjectInspectionError(
      "PROJECT_PATH_UNAVAILABLE",
      manifestPath,
      `\u65E0\u6CD5\u8BFB\u53D6 ${manifestPath}\uFF1B\u8BF7\u68C0\u67E5\u8DEF\u5F84\u548C\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
      [],
      { cause }
    );
  }
  const manifestBytes = decodeUtf8(manifestBuffer, manifestPath, "narracut.json", false);
  const parsedManifest = parseControlJson(
    manifestBytes,
    manifestPath,
    "narracut.json",
    MANIFEST_JSON_LIMITS
  );
  if (typeof parsedManifest !== "object" || parsedManifest === null || Array.isArray(parsedManifest) || !("kind" in parsedManifest) || parsedManifest.kind !== "narracut-project") {
    throw new ProjectInspectionError(
      "NOT_A_NARRACUT_PROJECT",
      manifestPath,
      `\u8BE5\u76EE\u5F55\u6CA1\u6709\u6709\u6548\u7684 Project VNext \u6807\u8BC6\uFF1B\u8BF7\u9009\u62E9\u5305\u542B kind=narracut-project \u6E05\u5355\u7684\u9879\u76EE\u76EE\u5F55\u3002`
    );
  }
  const manifest = parsedManifest;
  if (Number.isInteger(manifest.formatVersion) && manifest.formatVersion !== 1) {
    throw new ProjectInspectionError(
      "PROJECT_FORMAT_UNSUPPORTED",
      manifestPath,
      `\u9879\u76EE\u683C\u5F0F\u7248\u672C ${String(manifest.formatVersion)} \u4E0D\u53D7\u652F\u6301\uFF1B\u8BF7\u4F7F\u7528\u652F\u6301\u8BE5\u683C\u5F0F\u7684 Narracut \u7248\u672C\u3002`
    );
  }
  const manifestDiagnostics = validateProjectManifest(manifest);
  if (manifestDiagnostics.length > 0) throw invalidContent(manifestPath, manifestDiagnostics);
  const requiredEntries = [
    [join2(projectDirectory, "assets"), "assets/", "directory"],
    [join2(projectDirectory, "speech"), "speech/", "directory"],
    [join2(projectDirectory, "renders"), "renders/", "directory"]
  ];
  for (const [path, component, kind] of requiredEntries) {
    try {
      if (kind === "directory") await requireDirectory(path);
      else await requireFile(path);
    } catch (cause) {
      if (isFileSystemError(cause) && cause.code !== "ENOENT") {
        throw new ProjectInspectionError(
          "PROJECT_PATH_UNAVAILABLE",
          path,
          `\u65E0\u6CD5\u8BFB\u53D6 ${path}\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
          [],
          { cause }
        );
      }
      throw missingContent(path, component);
    }
  }
  const renderProgramDirectories = await discoverRenderProgramDirectories(projectDirectory);
  if (renderProgramDirectories.length === 0) {
    throw missingContent(
      projectDirectory,
      "\u81F3\u5C11\u4E00\u4EFD\u5019\u9009\u6216\u4FEE\u8BA2\u5185\u90E8\u7684 render-program/"
    );
  }
  for (const programDirectory of renderProgramDirectories) {
    await validateRenderProgramDirectory(projectDirectory, programDirectory);
  }
  let projectBuffer;
  let videoBuffer;
  try {
    [projectBuffer, videoBuffer] = await Promise.all([
      readBoundedControlFile(
        join2(projectDirectory, "project.json"),
        "project.json",
        10 * 1024 * 1024
      ),
      readBoundedControlFile(
        join2(projectDirectory, "video.md"),
        "video.md",
        2 * 1024 * 1024
      )
    ]);
  } catch (cause) {
    if (cause instanceof ProjectInspectionError) throw cause;
    const path = isFileSystemError(cause) && typeof cause.path === "string" ? cause.path : projectDirectory;
    const component = path.startsWith(`${projectDirectory}/`) ? path.slice(projectDirectory.length + 1) : path;
    if (isFileSystemError(cause) && cause.code === "ENOENT") {
      throw missingContent(path, component);
    }
    throw new ProjectInspectionError(
      "PROJECT_PATH_UNAVAILABLE",
      path,
      `\u65E0\u6CD5\u8BFB\u53D6 ${path}\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
      [],
      { cause }
    );
  }
  const projectBytes = decodeUtf8(
    projectBuffer,
    join2(projectDirectory, "project.json"),
    "project.json",
    false
  );
  const videoBytes = decodeUtf8(
    videoBuffer,
    join2(projectDirectory, "video.md"),
    "video.md",
    true
  );
  const projectPath = join2(projectDirectory, "project.json");
  const parsedProject = parseControlJson(
    projectBytes,
    projectPath,
    "project.json",
    PROJECT_JSON_LIMITS
  );
  const projectValidation = validateProjectDsl(parsedProject);
  if (projectValidation.project === void 0) {
    throw invalidContent(projectPath, projectValidation.diagnostics);
  }
  let tts;
  try {
    tts = await readProjectTtsConfig(projectDirectory);
  } catch (cause) {
    if (cause instanceof ProjectTtsConfigError) {
      throw invalidControlFile(cause.path, {
        code: cause.code,
        component: "tts.json",
        jsonPath: "$",
        message: cause.message
      }, { cause });
    }
    throw cause;
  }
  const { assetStates, speechStates, timeline, warnings } = await validateProjectVNextResources(
    projectDirectory,
    projectValidation.project,
    {
      ...tts.status === "configured" ? { currentTtsProfileId: tts.profileId } : {},
      probeSpeechDurationMs: options.probeSpeechDurationMs
    }
  );
  return {
    projectDirectory,
    manifest,
    project: projectValidation.project,
    projectRevision: `sha256:${createHash2("sha256").update(projectBuffer).digest("hex")}`,
    videoBrief: videoBytes,
    videoBriefRevision: `sha256:${createHash2("sha256").update(videoBuffer).digest("hex")}`,
    renderPrograms: { directories: renderProgramDirectories },
    assetStates,
    tts,
    speechStates,
    timeline,
    warnings
  };
}

// src/server/program-bundle.ts
import { createHash as createHash6 } from "node:crypto";

// src/server/execution-capsule.ts
import { execFile as execFile3, spawn } from "node:child_process";
import { createHash as createHash5, randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, mkdtemp as mkdtemp2, rm as rm3, writeFile as writeFile2 } from "node:fs/promises";
import { tmpdir as tmpdir2 } from "node:os";
import { dirname as dirname3, join as join4 } from "node:path";
import { promisify as promisify3 } from "node:util";
import { StringDecoder } from "node:string_decoder";

// src/server/capsule-supervisor.ts
var CAPSULE_SUPERVISOR = String.raw`
import { spawn } from 'node:child_process';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
const [entry, outputLimit, logLimit] = process.argv.slice(2);
const lines = createInterface({ input: process.stdin });
process.stdout.write('READY\n');
for await (const line of lines) {
  if (line === 'GO') break;
  if (line.startsWith('DOWNLOAD ')) {
    const bytes = Buffer.from(line.slice(9), 'base64');
    if (bytes.length > Number(outputLimit)) process.exit(73);
    await writeFile('/output/package.tgz', bytes);
    break;
  }
  process.exit(70);
}
lines.close();
// 普通限额临时文件，仅满足工具链对路径的要求；不挂载任何宿主设备。
await writeFile('/dev/null', '');
let logBytes = 0;
const child = spawn('/runtime/node', [entry], { cwd: '/output', env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end();
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
  logBytes += chunk.length;
  if (logBytes > Number(logLimit)) process.exit(73);
});
child.on('error', () => process.exit(70));
child.on('close', async code => {
  // Linux 的 kill(-1) 排除调用者和 namespace init；先终止其他进程再读取输出。
  try { process.kill(-1, 'SIGKILL'); } catch {}
  if (code !== 0) process.exit(code === null ? 73 : 71);
  const files = [];
  let size = 0;
  async function collect(path, depth = 0) {
    if (depth > 16) throw new Error();
    for (const name of await readdir('/output/' + path)) {
      const relative = path + name;
      const facts = await lstat('/output/' + relative);
      if (facts.isDirectory()) await collect(relative + '/', depth + 1);
      else {
        if (!facts.isFile() || facts.nlink !== 1 || files.length >= 1024) throw new Error();
        size += facts.size;
        if (size > Number(outputLimit)) throw new Error();
        const bytes = await readFile('/output/' + relative);
        if (bytes.length !== facts.size) throw new Error();
        files.push([relative, bytes.toString('base64')]);
      }
    }
  }
  try { await collect(''); process.stdout.write(JSON.stringify(files) + '\n'); }
  catch { process.exit(73); }
});
`;
var CAPSULE_PROBE = String.raw`
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
const denied = [];
for (const path of ['/etc/passwd', '/home', '/run/docker.sock', '/dev/sda', '/sys/fs/cgroup/cgroup.procs']) {
  try { await readFile(path); throw new Error('宿主文件可读'); }
  catch (error) { if (!['ENOENT', 'EACCES', 'EISDIR'].includes(error.code)) throw error; denied.push(path); }
}
for (const path of ['/escape', '/inputs/program/main.mjs', '/runtime/node']) {
  try { await writeFile(path, 'escape'); throw new Error('只读边界失效'); }
  catch (error) { if (!['EROFS', 'EACCES'].includes(error.code)) throw error; }
}
for (const host of ['127.0.0.1', '169.254.169.254', '1.1.1.1']) {
  await new Promise((resolve, reject) => {
    const socket = connect({ host, port: 80 });
    socket.on('connect', () => { socket.destroy(); reject(new Error('网络隔离失效')); });
    socket.on('error', resolve);
    socket.setTimeout(500, () => { socket.destroy(); reject(new Error('网络边界未得到确定验证')); });
  });
}
const status = await readFile('/proc/self/status', 'utf8');
if (!/^CapEff:\s+0+$/m.test(status)) throw new Error('保留了 Linux capabilities');
if (process.env.TZ !== 'UTC' || process.env.LC_ALL !== 'C.UTF-8' || Object.keys(process.env).length !== 11 || process.env.PWD !== "/output") throw new Error('环境不固定');
await writeFile('/output/proof.json', JSON.stringify({ denied, isolated: true }));
`;

// src/server/capsule-toolchain.ts
import { execFile as execFile2 } from "node:child_process";
import { createHash as createHash3 } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile as readFile2, readdir as readdir2, realpath as realpath2, rm as rm2, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname as dirname2, join as join3, resolve as resolve2 } from "node:path";
import { arch, release } from "node:os";
import { rmSync } from "node:fs";
import { promisify as promisify2 } from "node:util";
import { fileURLToPath } from "node:url";
var exec = promisify2(execFile2);
async function snapshotCapsuleToolchain() {
  const root = await mkdtemp(join3(tmpdir(), "narracut-toolchain-"));
  const hashes = /* @__PURE__ */ new Map();
  const groups = /* @__PURE__ */ new Map();
  let group = "node";
  async function add(source, destination, executable = false) {
    const target = join3(root, destination);
    if (!groups.has(destination)) groups.set(destination, /* @__PURE__ */ new Set());
    groups.get(destination).add(group);
    if (hashes.has(destination)) return;
    await mkdir(dirname2(target), { recursive: true });
    await copyFile(await realpath2(source), target);
    await chmod(target, executable ? 365 : 292);
    hashes.set(destination, createHash3("sha256").update(await readFile2(target)).digest("hex"));
  }
  async function libraries(binary) {
    const { stdout } = await exec("/usr/bin/ldd", [binary], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, maxBuffer: 1024 * 1024 });
    for (const match of stdout.matchAll(/(?:=>\s+|^\s*)(\/[^\s]+)\s+\(/gm)) await add(match[1], match[1], true);
    if (stdout.includes("not found")) throw new Error("\u5DE5\u5177\u94FE\u7F3A\u5C11\u52A8\u6001\u5E93");
  }
  async function tree(source, destination) {
    for (const item of await readdir2(source, { withFileTypes: true })) {
      const from = join3(source, item.name), to = join3(destination, item.name);
      if (item.isDirectory()) await tree(from, to);
      else if (item.isFile()) await add(from, to, !/\.(?:pak|dat|json|woff2|txt)$/.test(item.name));
      else throw new Error("\u5DE5\u5177\u94FE\u76EE\u5F55\u5305\u542B\u7279\u6B8A\u6587\u4EF6\u6216\u94FE\u63A5");
    }
  }
  try {
    await add(process.execPath, "/runtime/node", true);
    await libraries(process.execPath);
    group = "shell";
    await add("/bin/sh", "/bin/sh", true);
    await libraries(await realpath2("/bin/sh"));
    group = "browser";
    const applicationRoot2 = resolve2(dirname2(fileURLToPath(import.meta.url)), "../..");
    const browser = join3(applicationRoot2, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64");
    await tree(browser, "/runtime/browser");
    await libraries(join3(browser, "chrome-headless-shell"));
    for (const name of ["libEGL.so", "libGLESv2.so", "libvk_swiftshader.so", "libvulkan.so.1"]) await libraries(join3(browser, name));
    await tree(join3(applicationRoot2, "node_modules/@fontsource-variable/noto-sans-sc/files"), "/runtime/fonts");
    await add("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/runtime/fonts/fallback.ttf");
    for (const path of ["inputs", "output", "tmp", "proc", "dev/shm", "etc/fonts"]) await mkdir(join3(root, path), { recursive: true });
    await writeFile(join3(root, "supervisor.mjs"), "", { mode: 292 });
    const fontConfig = '<!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/runtime/fonts</dir><cachedir>/tmp/font-cache</cachedir></fontconfig>';
    await writeFile(join3(root, "etc/fonts/fonts.conf"), fontConfig, { mode: 292 });
    hashes.set("/etc/fonts/fonts.conf", createHash3("sha256").update(fontConfig).digest("hex"));
    groups.set("/etc/fonts/fonts.conf", /* @__PURE__ */ new Set(["browser"]));
    for (const path of ["/usr/bin/bwrap", "/usr/bin/systemd-run", "/usr/bin/systemctl"]) hashes.set(path, createHash3("sha256").update(await readFile2(path)).digest("hex"));
    const cleanup = () => rmSync(root, { recursive: true, force: true });
    process.once("exit", cleanup);
    return {
      root,
      files: [...groups].map(([path, roles2]) => ({ path, roles: [...roles2] })),
      identity: createHash3("sha256").update(JSON.stringify({ files: [...hashes].sort(), groups: [...groups].map(([path, groups2]) => [path, [...groups2]]), kernel: release(), arch: arch() })).digest("hex"),
      dispose: async () => {
        process.removeListener("exit", cleanup);
        await rm2(root, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await rm2(root, { recursive: true, force: true });
    throw error;
  }
}

// src/server/dependency-integrity.ts
import { createHash as createHash4 } from "node:crypto";
var DependencyError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var fail = (message) => {
  throw new DependencyError("DEPENDENCY_SOURCE_UNSUPPORTED", message);
};
function integrityKey(integrity) {
  if (typeof integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) return fail("\u4F9D\u8D56\u5FC5\u987B\u63D0\u4F9B\u89C4\u8303 SHA-512 \u5B8C\u6574\u6027\u6458\u8981\u3002");
  const bytes = Buffer.from(integrity.slice(7), "base64");
  if (bytes.toString("base64") !== integrity.slice(7)) return fail("\u4F9D\u8D56\u5B8C\u6574\u6027\u6458\u8981\u4E0D\u662F\u89C4\u8303 Base64\u3002");
  return bytes.toString("hex");
}
function verifyPackageBytes(key, bytes) {
  if (createHash4("sha512").update(bytes).digest("hex") !== key) throw new DependencyError("DEPENDENCY_INTEGRITY_FAILED", "\u79BB\u7EBF\u4F9D\u8D56\u5305\u5B8C\u6574\u6027\u4E0D\u7B26\uFF1B\u8BF7\u663E\u5F0F\u534F\u8C03\u4FEE\u590D\u3002");
}

// src/server/capsule-registry.ts
var REGISTRY = "https://registry.npmjs.org";
var MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
var fail2 = (message) => {
  throw new DependencyError("DEPENDENCY_SOURCE_UNSUPPORTED", message);
};
function registryURL(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return fail2("\u4F9D\u8D56 URL \u65E0\u6548\u3002");
  }
  if (url.origin !== REGISTRY || url.username || url.password || url.search || url.hash) fail2("\u4F9D\u8D56\u4E0E\u91CD\u5B9A\u5411\u53EA\u80FD\u6765\u81EA\u56FA\u5B9A\u516C\u5171 npm registry\uFF0C\u4E14\u4E0D\u5F97\u643A\u5E26\u51ED\u636E\u3002");
  return url.href;
}
async function fetchRegistryPackage(pin, cancellation) {
  const basename4 = pin.name.split("/").at(-1);
  let url = registryURL(`${REGISTRY}/${pin.name}/-/${basename4}-${pin.version}.tgz`);
  const signal = AbortSignal.any([AbortSignal.timeout(3e4), ...cancellation ? [cancellation] : []]);
  for (let redirects = 0; redirects <= 4; redirects++) {
    let response;
    try {
      response = await fetch(url, { redirect: "manual", credentials: "omit", headers: { accept: "application/octet-stream" }, signal });
    } catch {
      throw new DependencyError("DEPENDENCY_UNAVAILABLE", `\u4F9D\u8D56\u4E0B\u8F7D\u4E2D\u65AD\uFF1A${pin.name}@${pin.version}\uFF1B\u8BF7\u663E\u5F0F\u91CD\u8BD5\u3002`);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) fail2("registry \u91CD\u5B9A\u5411\u7F3A\u5C11\u76EE\u6807\u3002");
      url = registryURL(new URL(location, url).href);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new DependencyError("DEPENDENCY_UNAVAILABLE", `\u516C\u5171 npm \u5305\u4E0B\u8F7D\u5931\u8D25\uFF1A${pin.name}@${pin.version}\u3002`);
    }
    if (response.url) registryURL(response.url);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_PACKAGE_BYTES) fail2("\u4F9D\u8D56\u4E0B\u8F7D\u8F93\u51FA\u8D85\u8FC7\u9636\u6BB5\u4E0A\u9650 32 MiB\u3002");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    verifyPackageBytes(integrityKey(pin.integrity), bytes);
    return bytes;
  }
  return fail2("\u4F9D\u8D56\u91CD\u5B9A\u5411\u6B21\u6570\u8D85\u9650\u3002");
}

// src/server/execution-capsule.ts
var CapsuleError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var CAPSULE_BROWSER_ARGUMENTS = Object.freeze([
  "--no-sandbox",
  "--no-zygote",
  "--in-process-gpu",
  "--headless",
  "--disable-dev-shm-usage",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--remote-debugging-pipe"
]);
var MiB = 1024 * 1024;
var exec2 = promisify3(execFile3);
var environment = Object.freeze({
  PWD: "/output",
  PATH: "/runtime:/bin",
  HOME: "/tmp/home",
  TMPDIR: "/tmp",
  TZ: "UTC",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  FONTCONFIG_FILE: "/etc/fonts/fonts.conf",
  NARRACUT_BROWSER: "/runtime/browser/chrome-headless-shell",
  NARRACUT_BROWSER_GL: "swiftshader",
  VK_ICD_FILENAMES: "/runtime/browser/vk_swiftshader_icd.json"
});
var limits = (memory, disk, output, wallMs, pids = 64) => Object.freeze({ memory: memory * MiB, pids, disk: disk * MiB, output: output * MiB, logs: MiB, wallMs });
var CAPSULE_POLICIES = Object.freeze({
  download: limits(256, 64, 32, 3e4),
  install: limits(512, 256, 128, 6e4),
  build: limits(1024, 256, 128, 12e4),
  metadata: limits(1024, 64, 4, 3e4, 256),
  preview: limits(1024, 128, 64, 12e4, 256),
  render: limits(2048, 512, 256, 3e5, 256)
});
var roles = {
  download: ["dependencies"],
  install: ["dependencies"],
  build: ["program", "runtime", "dependencies"],
  metadata: ["bundle", "input"],
  preview: ["bundle", "input", "media"],
  render: ["bundle", "input", "media"]
};
var safePath = (path) => path.length <= 512 && !path.includes("\\") && !path.includes("\0") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
var failure = (code) => new CapsuleError(code, {
  CAPSULE_UNAVAILABLE: "\u8BA4\u8BC1\u6267\u884C\u80F6\u56CA\u4E0D\u53EF\u7528\uFF1B\u8BF7\u68C0\u67E5 Linux\u3001bubblewrap\u3001\u7528\u6237 systemd \u4E0E\u56FA\u5B9A\u5DE5\u5177\u94FE\u3002",
  CAPSULE_SELF_TEST_FAILED: "\u6267\u884C\u80F6\u56CA\u80FD\u529B\u81EA\u68C0\u5931\u8D25\uFF0C\u5DF2\u963B\u65AD\u9879\u76EE\u4EE3\u7801\u6267\u884C\u3002",
  CAPSULE_TIMEOUT: "\u6267\u884C\u80F6\u56CA\u8FBE\u5230\u5899\u949F\u4E0A\u9650\uFF0C\u5DF2\u9500\u6BC1\u5168\u90E8\u8FDB\u7A0B\u5E76\u4E22\u5F03\u8F93\u51FA\u3002",
  CAPSULE_RESOURCE_EXCEEDED: "\u6267\u884C\u80F6\u56CA\u8D85\u51FA\u8D44\u6E90\u6216\u8F93\u51FA\u8FB9\u754C\uFF0C\u5DF2\u9500\u6BC1\u5168\u90E8\u8FDB\u7A0B\u5E76\u4E22\u5F03\u8F93\u51FA\u3002",
  CAPSULE_CANCELLED: "\u6267\u884C\u5DF2\u53D6\u6D88\uFF0C\u80F6\u56CA\u8F93\u51FA\u5DF2\u4E22\u5F03\u3002",
  CAPSULE_OUTPUT_INVALID: "\u80F6\u56CA\u8F93\u51FA\u672A\u901A\u8FC7\u9A8C\u8BC1\uFF0C\u5DF2\u4E22\u5F03\u3002",
  CAPSULE_EXECUTION_FAILED: "\u9879\u76EE\u4EE3\u7801\u6267\u884C\u5931\u8D25\uFF0C\u80F6\u56CA\u8F93\u51FA\u5DF2\u4E22\u5F03\u3002"
}[code] ?? "\u6267\u884C\u80F6\u56CA\u8BF7\u6C42\u4E0D\u7B26\u5408\u9636\u6BB5\u80FD\u529B\u7EA6\u675F\u3002");
var ExecutionCapsule = class _ExecutionCapsule {
  #toolchain;
  #certification;
  /** 不接受项目提供的可执行文件、环境、挂载或后端；工具链只从应用安装位置生成。 */
  static async local() {
    if (process.platform !== "linux") throw failure("CAPSULE_UNAVAILABLE");
    const capsule = new _ExecutionCapsule();
    try {
      capsule.#toolchain = await snapshotCapsuleToolchain();
    } catch {
      throw failure("CAPSULE_UNAVAILABLE");
    }
    return capsule;
  }
  async dispose() {
    await this.#toolchain?.dispose();
    this.#toolchain = void 0;
    this.#certification = void 0;
  }
  async certify() {
    if (!this.#toolchain) throw failure("CAPSULE_UNAVAILABLE");
    return this.#certification ??= this.#selfTest().catch((error) => {
      this.#certification = void 0;
      throw error;
    });
  }
  async #selfTest() {
    try {
      for (const stage of Object.keys(CAPSULE_POLICIES)) {
        const files = await this.#execute(stage, { "program/main.mjs": Buffer.from(CAPSULE_PROBE) }, "program/main.mjs");
        const proof = JSON.parse(files.get("proof.json")?.toString() ?? "null");
        if (proof?.isolated !== true || proof.denied.length !== 5) throw failure("CAPSULE_SELF_TEST_FAILED");
      }
      const probeLimits = { memory: 128 * MiB, pids: 32, disk: 2 * MiB, output: MiB, logs: 4096, wallMs: 3e3 };
      const probes = [
        ["import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';let n=0;function next(){const p=spawn('/bin/sh',['-c','read value']);p.once('spawn',()=>{if(++n>40)process.exit(2);next()});p.once('error',e=>{if(e.code!=='EAGAIN')process.exit(2);writeFileSync('/output/proof','limited');process.exit(0)})}next();", null],
        ["import{openSync,writeSync,writeFileSync}from'node:fs';const fd=openSync('/tmp/fill','w');try{for(let i=0;i<4;i++)writeSync(fd,Buffer.alloc(1024*1024,1));process.exit(2)}catch(e){if(e.code!=='ENOSPC')process.exit(2);writeFileSync('/output/proof','limited')}", null],
        ["const held=[];setInterval(()=>held.push(Buffer.alloc(16*1024*1024,1)),5);", "CAPSULE_RESOURCE_EXCEEDED"],
        ["process.stdout.write('x'.repeat(8192));setInterval(()=>{},100);", "CAPSULE_RESOURCE_EXCEEDED"],
        ["import{spawn}from'node:child_process';spawn('/bin/sh',['-c','while :; do :; done'],{detached:true});setInterval(()=>{},100);", "CAPSULE_TIMEOUT"]
      ];
      for (const [source, expected] of probes) {
        try {
          const output = await this.#execute("build", { "program/main.mjs": Buffer.from(source) }, "program/main.mjs", void 0, void 0, probeLimits);
          if (expected !== null || output.get("proof")?.toString() !== "limited") throw failure("CAPSULE_SELF_TEST_FAILED");
        } catch (error) {
          if (!expected || !(error instanceof CapsuleError) || error.code !== expected) throw error;
        }
      }
      const browserProof = await this.#execute("metadata", { "bundle/main.mjs": Buffer.from(`
        import{spawn}from'node:child_process';import{writeFileSync,readFileSync}from'node:fs';
        const p=spawn(process.env.NARRACUT_BROWSER,${JSON.stringify(CAPSULE_BROWSER_ARGUMENTS)},{stdio:['pipe','pipe','pipe','pipe','pipe']});
        p.stderr.resume();p.stdout.resume();p.on('error',()=>process.exit(2));
        let sequence=0,wire='';const waiting=new Map();
        p.stdio[4].on('data',b=>{wire+=b.toString();let cut;while((cut=wire.indexOf(String.fromCharCode(0)))>=0){const message=JSON.parse(wire.slice(0,cut));wire=wire.slice(cut+1);if(waiting.has(message.id)){const {resolve,reject}=waiting.get(message.id);waiting.delete(message.id);message.error?reject(new Error(JSON.stringify(message))):resolve(message.result)}}});
        function command(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});p.stdio[3].write(JSON.stringify({id,method,params,sessionId})+String.fromCharCode(0))})}
        await command('Browser.getVersion');
        const {targetId}=await command('Target.createTarget',{url:'about:blank'});
        const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
        await command('Page.enable',{},sessionId);
        const {frameTree}=await command('Page.getFrameTree',{},sessionId);
        await command('Page.setDocumentContent',{frameId:frameTree.frame.id,html:'<style>@font-face{font-family:fixed;src:url(data:font/woff2;base64,'+readFileSync('/runtime/fonts/noto-sans-sc-latin-wght-normal.woff2').toString('base64')+')}body{font-family:fixed}</style><p>capsule-browser</p>'},sessionId);
        const evaluated=await command('Runtime.evaluate',{expression:'document.fonts.ready.then(()=>document.body.innerText.includes("capsule-browser"))',awaitPromise:true},sessionId);
        if(evaluated.result.value!==true)throw new Error(JSON.stringify(evaluated));
        const shot=await command('Page.captureScreenshot',{format:'png'},sessionId);
        if(!shot.data)throw new Error(JSON.stringify(shot));writeFileSync('/output/browser','fixed');process.exit(0);
      `) }, "bundle/main.mjs");
      if (browserProof.get("browser")?.toString() !== "fixed") throw failure("CAPSULE_SELF_TEST_FAILED");
      return createHash5("sha256").update(JSON.stringify({ protocol: 1, toolchain: this.#toolchain.identity, environment, browserArguments: CAPSULE_BROWSER_ARGUMENTS, policies: CAPSULE_POLICIES, supervisor: CAPSULE_SUPERVISOR, probe: CAPSULE_PROBE, roles, backend: this.#execute.toString(), certification: this.#selfTest.toString() })).digest("hex");
    } catch (error) {
      if (error instanceof CapsuleError && error.code === "CAPSULE_UNAVAILABLE") throw error;
      throw failure("CAPSULE_SELF_TEST_FAILED");
    }
  }
  async run(request, validate) {
    await this.certify();
    if (request.signal?.aborted) throw failure("CAPSULE_CANCELLED");
    if (!Object.hasOwn(CAPSULE_POLICIES, request.stage) || request.stage === "download") throw failure("CAPSULE_REQUEST_INVALID");
    const entries = Object.entries(request.inputs);
    if (entries.length > 4096 || entries.some(([path, bytes]) => !safePath(path) || !roles[request.stage].includes(path.split("/")[0]) || !(bytes instanceof Uint8Array)) || !Object.hasOwn(request.inputs, request.entry) || entries.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0) > CAPSULE_POLICIES[request.stage].disk) throw failure("CAPSULE_REQUEST_INVALID");
    const inputs = Object.fromEntries(entries.map(([path, bytes]) => [path, Buffer.from(bytes)]));
    const output = await this.#execute(request.stage, inputs, request.entry, request.signal);
    if (request.signal?.aborted) throw failure("CAPSULE_CANCELLED");
    if (!await validate(output)) throw failure("CAPSULE_OUTPUT_INVALID");
    if (request.signal?.aborted) throw failure("CAPSULE_CANCELLED");
    return output;
  }
  /** 下载阶段唯一宿主能力是固定 registry 的无凭据字节代理，不能运行调用者代码。 */
  async downloadPackage(pin, signal) {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(pin.name) || pin.name.length > 214 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pin.version) || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pin.integrity)) throw failure("CAPSULE_REQUEST_INVALID");
    await this.certify();
    if (signal?.aborted) throw failure("CAPSULE_CANCELLED");
    const source = `import {readFile} from 'node:fs/promises'; import {createHash} from 'node:crypto';
      if ('sha512-' + createHash('sha512').update(await readFile('/output/package.tgz')).digest('base64') !== ${JSON.stringify(pin.integrity)}) process.exit(71);`;
    const output = await this.#execute(
      "download",
      { "dependencies/verify.mjs": Buffer.from(source) },
      "dependencies/verify.mjs",
      signal,
      (cancellation) => fetchRegistryPackage(pin, cancellation)
    );
    const bytes = output.get("package.tgz");
    if (signal?.aborted) throw failure("CAPSULE_CANCELLED");
    if (output.size !== 1 || !bytes || `sha512-${createHash5("sha512").update(bytes).digest("base64")}` !== pin.integrity) throw failure("CAPSULE_OUTPUT_INVALID");
    return bytes;
  }
  async #execute(stage, inputs, entry, signal, download2, certificationLimits) {
    if (!this.#toolchain) throw failure("CAPSULE_UNAVAILABLE");
    const policy = certificationLimits ?? CAPSULE_POLICIES[stage];
    const directory2 = await mkdtemp2(join4(tmpdir2(), "narracut-capsule-"));
    const unit = `narracut-capsule-${randomUUID2()}.service`;
    const controlEnv = { PATH: "/usr/bin:/bin", LC_ALL: "C", XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` };
    const control = (...args) => exec2("/usr/bin/systemctl", ["--user", ...args], { env: controlEnv, timeout: 5e3, maxBuffer: 64 * 1024 });
    try {
      const inputRoot = join4(directory2, "inputs");
      await mkdir2(inputRoot);
      for (const [path, bytes2] of Object.entries(inputs)) {
        const target = join4(inputRoot, path);
        await mkdir2(dirname3(target), { recursive: true });
        await writeFile2(target, bytes2, { mode: 292 });
      }
      const supervisor = join4(directory2, "supervisor.mjs");
      await writeFile2(supervisor, CAPSULE_SUPERVISOR, { mode: 292 });
      const args = [
        "--user",
        "--quiet",
        "--wait",
        "--pipe",
        `--unit=${unit}`,
        "-p",
        `MemoryMax=${policy.memory}`,
        "-p",
        "MemorySwapMax=0",
        "-p",
        `TasksMax=${policy.pids}`,
        "-p",
        `RuntimeMaxSec=${policy.wallMs / 1e3}`,
        "-p",
        "KillMode=control-group",
        "-p",
        "TimeoutStopSec=1",
        "-p",
        "SendSIGKILL=yes",
        "-p",
        "OOMPolicy=kill",
        "-p",
        "NoNewPrivileges=yes",
        "-p",
        "KeyringMode=private",
        "/usr/bin/bwrap",
        "--unshare-all",
        "--unshare-user",
        "--unshare-cgroup",
        "--disable-userns",
        "--assert-userns-disabled",
        "--die-with-parent",
        "--new-session",
        "--cap-drop",
        "ALL",
        "--clearenv",
        "--hostname",
        "narracut",
        "--tmpfs",
        "/",
        ...this.#toolchain.files.filter((file) => file.roles.includes("node") || ["install", "build"].includes(stage) && file.roles.includes("shell") || ["metadata", "preview", "render"].includes(stage) && file.roles.includes("browser")).flatMap((file) => ["--ro-bind", join4(this.#toolchain.root, file.path), file.path]),
        "--ro-bind",
        inputRoot,
        "/inputs",
        "--ro-bind",
        supervisor,
        "/supervisor.mjs",
        "--proc",
        "/proc",
        "--size",
        String(policy.disk),
        "--tmpfs",
        "/tmp",
        "--size",
        String(policy.output),
        "--tmpfs",
        "/output",
        "--size",
        String(MiB),
        "--tmpfs",
        "/dev",
        "--size",
        String(16 * MiB),
        "--tmpfs",
        "/dev/shm",
        ...Object.entries(environment).flatMap(([key, value]) => ["--setenv", key, value]),
        "--remount-ro",
        "/",
        "--chdir",
        "/output",
        "/runtime/node",
        "/supervisor.mjs",
        `/inputs/${entry}`,
        String(policy.output),
        String(policy.logs)
      ];
      const child = spawn("/usr/bin/systemd-run", args, { env: controlEnv, stdio: ["pipe", "pipe", "pipe"] });
      let error;
      let ready = false, bytes = 0, stderrBytes = 0;
      let wire = "";
      const decoder = new StringDecoder("utf8");
      const broker = new AbortController();
      let brokerError;
      let stopping;
      const stop = (code) => {
        error ??= failure(code);
        broker.abort();
        return stopping ??= control("stop", unit).catch(() => void 0);
      };
      const abort = () => {
        void stop("CAPSULE_CANCELLED");
      };
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => {
        void stop("CAPSULE_TIMEOUT");
      }, policy.wallMs + 5e3);
      child.stdin.on("error", () => {
      });
      child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > policy.logs) void stop("CAPSULE_RESOURCE_EXCEEDED");
      });
      child.stdout.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > policy.output * 1.4 + MiB) {
          void stop("CAPSULE_RESOURCE_EXCEEDED");
          return;
        }
        wire += decoder.write(chunk);
        if (!ready && wire.includes("\n")) {
          ready = true;
          if (!wire.startsWith("READY\n")) {
            void stop("CAPSULE_SELF_TEST_FAILED");
            return;
          }
          wire = wire.slice(6);
          void (async () => {
            try {
              const { stdout } = await control("show", unit, "--property=MemoryMax,MemorySwapMax,TasksMax,KillMode,NoNewPrivileges,RuntimeMaxUSec,SendSIGKILL,OOMPolicy");
              const properties = Object.fromEntries(stdout.trim().split("\n").map((line) => line.split("=")));
              if (properties.MemoryMax !== String(policy.memory) || properties.MemorySwapMax !== "0" || properties.TasksMax !== String(policy.pids) || properties.KillMode !== "control-group" || properties.NoNewPrivileges !== "yes" || properties.SendSIGKILL !== "yes" || properties.OOMPolicy !== "kill" || properties.RuntimeMaxUSec !== `${policy.wallMs / 1e3 % 60 === 0 ? policy.wallMs / 6e4 + "min" : policy.wallMs / 1e3 + "s"}`) throw failure("CAPSULE_SELF_TEST_FAILED");
              if (error || signal?.aborted) {
                await control("stop", unit);
                error ??= failure("CAPSULE_CANCELLED");
              } else if (download2) {
                try {
                  child.stdin.end(`DOWNLOAD ${(await download2(broker.signal)).toString("base64")}
`);
                } catch (cause) {
                  brokerError = cause;
                  await stop("CAPSULE_EXECUTION_FAILED");
                }
              } else child.stdin.end("GO\n");
            } catch {
              await stop("CAPSULE_SELF_TEST_FAILED");
            }
          })();
        }
      });
      let exitCode;
      try {
        exitCode = await new Promise((resolve4) => {
          child.once("error", () => {
            error = failure("CAPSULE_UNAVAILABLE");
            resolve4(null);
          });
          child.once("close", resolve4);
        });
        await stopping;
      } finally {
        clearTimeout(timeout);
        broker.abort();
        signal?.removeEventListener("abort", abort);
      }
      if (brokerError && error?.code === "CAPSULE_EXECUTION_FAILED") throw brokerError;
      if (error) throw error;
      if (!ready) throw failure("CAPSULE_UNAVAILABLE");
      if (exitCode !== 0) {
        const { stdout } = await control("show", unit, "--property=Result").catch(() => ({ stdout: "" }));
        throw failure(stdout.includes("timeout") ? "CAPSULE_TIMEOUT" : stdout.includes("oom-kill") || exitCode === 73 ? "CAPSULE_RESOURCE_EXCEEDED" : "CAPSULE_EXECUTION_FAILED");
      }
      wire += decoder.end();
      try {
        const values = JSON.parse(wire);
        if (!Array.isArray(values) || values.length > 1024) throw new Error();
        const output = /* @__PURE__ */ new Map();
        let size = 0;
        for (const value of values) {
          if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || !safePath(value[0]) || typeof value[1] !== "string" || output.has(value[0])) throw new Error();
          const data = Buffer.from(value[1], "base64");
          if (data.toString("base64") !== value[1] || (size += data.length) > policy.output) throw new Error();
          output.set(value[0], data);
        }
        return output;
      } catch {
        throw failure("CAPSULE_OUTPUT_INVALID");
      }
    } finally {
      await control("stop", unit).catch(() => void 0);
      await control("reset-failed", unit).catch(() => void 0);
      await rm3(directory2, { recursive: true, force: true });
    }
  }
};
var local;
function localExecutionCapsule() {
  return local ??= ExecutionCapsule.local().catch((error) => {
    local = void 0;
    throw error;
  });
}

// src/server/project-dependencies.ts
var import_yaml = __toESM(require_dist(), 1);
var import_semver = __toESM(require_semver2(), 1);
import { gunzipSync } from "node:zlib";
var RUNTIME_REMOTION_VERSION = "4.0.512";
var fail3 = (message) => {
  throw new DependencyError("DEPENDENCY_SOURCE_UNSUPPORTED", message);
};
var nameValid = (name) => typeof name === "string" && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) && name.length <= 214;
var versionValid = (version) => typeof version === "string" && (0, import_semver.valid)(version) === version;
var record = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function validatePin(pin) {
  if (!record(pin) || Object.keys(pin).some((k) => !["name", "version", "integrity"].includes(k)) || !nameValid(pin.name) || !versionValid(pin.version)) fail3("\u53EA\u5141\u8BB8\u516C\u5171 npm \u5305\u540D\u3001\u7CBE\u786E\u7248\u672C\u548C\u5B8C\u6574\u6027\u6458\u8981\uFF1B\u4E0D\u63A5\u53D7\u6765\u6E90\u6216\u51ED\u636E\u5B57\u6BB5\u3002");
  integrityKey(pin.integrity);
  if ((pin.name === "remotion" || pin.name.startsWith("@remotion/") || pin.name === "@narracut/runtime") && pin.version !== RUNTIME_REMOTION_VERSION) {
    throw new DependencyError("REMOTION_VERSION_MISMATCH", `\u5168\u90E8 Remotion \u5305\u5FC5\u987B\u4E0E Runtime \u7CBE\u786E\u540C\u7248 ${RUNTIME_REMOTION_VERSION}\u3002`);
  }
}
async function download(pin) {
  return (await localExecutionCapsule()).downloadPackage(pin);
}
function packageManifest(bytes, pin, files) {
  let tar;
  try {
    tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 });
  } catch {
    return fail3("\u4F9D\u8D56\u5FC5\u987B\u662F\u6709\u6548\u4E14\u672A\u8D85\u9650\u7684 gzip tar \u5305\u3002");
  }
  let manifest;
  const paths = /* @__PURE__ */ new Set();
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const string = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const octal = (start, length) => {
      const raw = string(start, length).trim();
      if (!/^[0-7]+$/.test(raw)) return fail3("\u4F9D\u8D56 tar \u6570\u5B57\u5B57\u6BB5\u65E0\u6548\u3002");
      return parseInt(raw, 8);
    };
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (octal(148, 8) !== checksum) fail3("\u4F9D\u8D56 tar \u6821\u9A8C\u548C\u9519\u8BEF\u3002");
    const size = octal(124, 12);
    const prefix = string(345, 155);
    const path = `${prefix ? prefix + "/" : ""}${string(0, 100)}`.replace(/\/$/, "");
    const type = header[156];
    if (![0, 48, 53].includes(type) || !path.startsWith("package") || path !== "package" && !path.startsWith("package/") || path.includes("\\") || path.split("/").some((p) => !p || p === "." || p === ".." || p === "node_modules") || paths.has(path) || type === 53 && size !== 0 || offset + 512 + size > tar.length) fail3("\u4F9D\u8D56 tar \u542B\u4E0D\u5B89\u5168\u8DEF\u5F84\u3001\u94FE\u63A5\u3001\u7279\u6B8A\u6587\u4EF6\u6216\u635F\u574F\u6761\u76EE\u3002");
    paths.add(path);
    if (type !== 53 && path.startsWith("package/")) files?.set(path.slice(8), Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    if (path === "package/package.json") {
      if (type === 53 || size > 1024 * 1024) fail3("\u4F9D\u8D56\u5305\u58F0\u660E\u65E0\u6548\u3002");
      try {
        manifest = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString("utf8"));
      } catch {
        fail3("\u4F9D\u8D56\u5305\u58F0\u660E\u4E0D\u662F\u6709\u6548 JSON\u3002");
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!record(manifest) || manifest.name !== pin.name || manifest.version !== pin.version) return fail3("\u4F9D\u8D56 tar \u5185\u5305\u540D\u6216\u7248\u672C\u4E0E\u7CBE\u786E\u58F0\u660E\u4E0D\u7B26\u3002");
  if (manifest.bundledDependencies?.length || manifest.bundleDependencies?.length) fail3("\u4E0D\u63A5\u53D7\u5305\u5185\u5D4C\u5957\u4F9D\u8D56\uFF1B\u8BF7\u4E3A\u5B8C\u6574\u9501\u56FE\u63D0\u4F9B\u7CBE\u786E\u5305\u3002");
  return manifest;
}
async function coordinateDependencies(manifestBytes, lockBytes, stored, request, retainedLocks = [], retainedKeys = []) {
  if (Object.keys(request).some((key) => !["action", "baseline", "dependencies", "packages"].includes(key))) fail3("\u4F9D\u8D56\u534F\u8C03\u4E0D\u63A5\u53D7\u81EA\u5B9A\u4E49 registry\u3001\u6765\u6E90\u6216\u51ED\u636E\u5B57\u6BB5\u3002");
  if (!record(request.dependencies) || !Array.isArray(request.packages) || request.packages.length > 256) fail3("\u4F9D\u8D56\u534F\u8C03\u5FC5\u987B\u63D0\u4F9B\u4F9D\u8D56\u58F0\u660E\u4E0E\u7CBE\u786E\u5305\u5217\u8868\uFF08\u6700\u591A 256 \u9879\uFF09\u3002");
  for (const [name, version] of Object.entries(request.dependencies)) if (!nameValid(name) || !versionValid(version)) fail3("\u53EA\u63A5\u53D7\u7CBE\u786E\u516C\u5171 npm \u7248\u672C\uFF1B\u62D2\u7EDD\u7248\u672C\u8303\u56F4\u3001Git\u3001URL\u3001file \u4E0E\u79C1\u6709\u6765\u6E90\u3002");
  const original = JSON.parse(manifestBytes.toString());
  const lock = (0, import_yaml.parse)(lockBytes.toString(), { maxAliasCount: 0 });
  if (!record(original) || !record(original.dependencies) || !record(lock) || !record(lock.packages)) fail3("\u5019\u9009\u4F9D\u8D56\u58F0\u660E\u6216\u9501\u56FE\u65E0\u6548\u3002");
  const dependencies = { ...original.dependencies, ...request.dependencies };
  const pins = /* @__PURE__ */ new Map();
  for (const [key, value] of Object.entries(lock.packages)) {
    const split = key.lastIndexOf("@");
    const pin = { name: key.slice(0, split), version: key.slice(split + 1), integrity: value?.resolution?.integrity };
    validatePin(pin);
    if (value.resolution.tarball || value.resolution.registry) fail3("\u9501\u56FE\u4E0D\u5F97\u6307\u5B9A\u81EA\u5B9A\u4E49\u6765\u6E90\u3002");
    pins.set(`${pin.name}@${pin.version}`, pin);
  }
  const retained = [...pins.values()];
  const supplied = /* @__PURE__ */ new Set();
  for (const pin of request.packages) {
    validatePin(pin);
    const id = `${pin.name}@${pin.version}`;
    if (supplied.has(id)) fail3("\u7CBE\u786E\u5305\u5217\u8868\u4E0D\u80FD\u5305\u542B\u91CD\u590D\u5305\u540D\u548C\u7248\u672C\u3002");
    supplied.add(id);
    pins.set(id, pin);
  }
  for (const [name, version] of Object.entries(dependencies)) {
    if (!nameValid(name) || !versionValid(version) || pins.get(`${name}@${version}`)?.version !== version) fail3(`\u7F3A\u5C11 ${name}@${version} \u7684\u7CBE\u786E\u7248\u672C\u4E0E\u5B8C\u6574\u6027\u6458\u8981\u3002`);
  }
  const nextStore = new Map(stored);
  for (const bytes of retainedLocks) {
    const retainedLock = (0, import_yaml.parse)(bytes.toString(), { maxAliasCount: 0 });
    if (!record(retainedLock?.packages)) fail3("\u4FDD\u7559\u72B6\u6001\u7684\u9501\u56FE\u65E0\u6548\u3002");
    for (const [id, value] of Object.entries(retainedLock.packages)) {
      const split = id.lastIndexOf("@");
      const pin = { name: id.slice(0, split), version: id.slice(split + 1), integrity: value?.resolution?.integrity };
      validatePin(pin);
      if (Object.keys(value.resolution).some((key) => key !== "integrity")) fail3("\u4FDD\u7559\u9501\u56FE\u5305\u542B\u4E0D\u652F\u6301\u7684\u4F9D\u8D56\u6765\u6E90\u3002");
      retained.push(pin);
    }
  }
  for (const pin of request.packages) if (retainedKeys.includes(integrityKey(pin.integrity))) retained.push(pin);
  for (const pin of retained) {
    const key = integrityKey(pin.integrity);
    if (!nextStore.has(key)) {
      const bytes = await download(pin);
      packageManifest(bytes, pin);
      nextStore.set(key, bytes);
    }
  }
  const packages = /* @__PURE__ */ Object.create(null);
  const snapshots = /* @__PURE__ */ Object.create(null);
  const visited = /* @__PURE__ */ new Set();
  async function visit(pin) {
    const packageId = `${pin.name}@${pin.version}`;
    if (visited.has(packageId)) return;
    if (visited.size >= 256) fail3("\u4F9D\u8D56\u56FE\u8D85\u8FC7\u534F\u8C03\u9636\u6BB5 256 \u5305\u4E0A\u9650\u3002");
    visited.add(packageId);
    const key = integrityKey(pin.integrity);
    let bytes = nextStore.get(key);
    if (bytes) verifyPackageBytes(key, bytes);
    else {
      bytes = await download(pin);
      nextStore.set(key, bytes);
    }
    const meta = packageManifest(bytes, pin);
    const edges = /* @__PURE__ */ Object.create(null);
    const targets = /* @__PURE__ */ new Map();
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      if (meta[field] !== void 0 && !record(meta[field])) fail3("\u4F9D\u8D56\u5305\u7684\u4F9D\u8D56\u5B57\u6BB5\u65E0\u6548\u3002");
      for (const [dependency, range] of Object.entries(meta[field] ?? {})) {
        if (!nameValid(dependency) || typeof range !== "string" || !(0, import_semver.validRange)(range)) fail3("\u4F20\u9012\u4F9D\u8D56\u53EA\u80FD\u4F7F\u7528\u516C\u5171 npm semver \u58F0\u660E\uFF0C\u4E0D\u80FD\u5305\u542B\u79C1\u6709\u6765\u6E90\u6216\u51ED\u636E\u3002");
        const root = pins.get(`${dependency}@${dependencies[dependency]}`);
        const target = root && (0, import_semver.satisfies)(root.version, range) ? root : [...pins.values()].filter((p) => p.name === dependency && (0, import_semver.satisfies)(p.version, range)).sort((a, b) => (0, import_semver.rcompare)(a.version, b.version))[0];
        const optionalPeer = field === "peerDependencies" && meta.peerDependenciesMeta?.[dependency]?.optional === true;
        if (!target && optionalPeer) continue;
        if (!target || !(0, import_semver.satisfies)(target.version, range)) fail3(`\u8BF7\u4E3A\u4F20\u9012\u4F9D\u8D56 ${dependency}\uFF08${range}\uFF09\u63D0\u4F9B\u517C\u5BB9\u7684\u7CBE\u786E\u7248\u672C\u4E0E\u6458\u8981\u3002`);
        edges[dependency] = target.version;
        targets.set(dependency, target);
      }
    }
    packages[packageId] = { resolution: { integrity: pin.integrity }, ...meta.bin ? { hasBin: true } : {} };
    snapshots[packageId] = Object.keys(edges).length ? { dependencies: edges } : {};
    for (const target of targets.values()) await visit(target);
  }
  for (const name of Object.keys(dependencies).sort()) await visit(pins.get(`${name}@${dependencies[name]}`));
  for (const name of supplied) if (!visited.has(name) && !retainedKeys.includes(integrityKey(pins.get(name).integrity))) fail3(`\u63D0\u4F9B\u7684\u5305 ${name} \u672A\u88AB\u5019\u9009\u4F9D\u8D56\u56FE\u5F15\u7528\u3002`);
  return {
    manifest: Buffer.from(JSON.stringify({ private: true, dependencies })),
    lock: Buffer.from((0, import_yaml.stringify)({ lockfileVersion: "9.0", settings: { autoInstallPeers: true, excludeLinksFromLockfile: false }, importers: { ".": { dependencies: Object.fromEntries(Object.entries(dependencies).map(([name, version]) => [name, { specifier: version, version }])) } }, packages, snapshots })),
    store: nextStore
  };
}
function unpackOfflinePackage(bytes, pin) {
  validatePin(pin);
  verifyPackageBytes(integrityKey(pin.integrity), bytes);
  const files = /* @__PURE__ */ new Map();
  const manifest = packageManifest(bytes, pin, files);
  return { files, manifest };
}
function readOfflineDependencyGraph(manifestBytes, lockBytes, store) {
  const invalid = (message) => {
    throw new DependencyError("DEPENDENCY_LOCK_INVALID", message);
  };
  let manifest, lock;
  try {
    manifest = JSON.parse(manifestBytes.toString());
    lock = (0, import_yaml.parse)(lockBytes.toString(), { maxAliasCount: 0 });
  } catch {
    return invalid("\u4F9D\u8D56\u58F0\u660E\u6216\u9501\u6587\u4EF6\u4E0D\u53EF\u89E3\u6790\u3002");
  }
  if (!record(manifest?.dependencies) || !record(lock?.packages) || !record(lock?.snapshots) || !record(lock?.importers?.["."]?.dependencies) || String(lock.lockfileVersion) !== "9.0") return invalid("\u4F9D\u8D56\u58F0\u660E\u548C\u5B8C\u6574\u9501\u56FE\u7F3A\u5931\u3002");
  if (Object.keys(manifest).some((k) => !["private", "dependencies"].includes(k)) || Object.keys(lock.importers).some((k) => k !== ".")) return invalid("\u4E0D\u652F\u6301\u9879\u76EE\u5B89\u88C5\u811A\u672C\u3001\u81EA\u5B9A\u4E49\u914D\u7F6E\u6216\u591A\u5DE5\u4F5C\u533A\u9501\u56FE\u3002");
  const pins = /* @__PURE__ */ new Map();
  for (const [id, item] of Object.entries(lock.packages)) {
    const split = id.lastIndexOf("@");
    const pin = { name: id.slice(0, split), version: id.slice(split + 1), integrity: item?.resolution?.integrity };
    validatePin(pin);
    if (!record(item?.resolution) || Object.keys(item.resolution).some((k) => k !== "integrity")) return invalid("\u9501\u56FE\u6765\u6E90\u5FC5\u987B\u4EC5\u7531\u516C\u5171\u5305\u8EAB\u4EFD\u548C\u5B8C\u6574\u6027\u6458\u8981\u51B3\u5B9A\u3002");
    pins.set(id, pin);
  }
  const roots = /* @__PURE__ */ Object.create(null);
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    const entry = lock.importers["."].dependencies[name];
    if (!nameValid(name) || !versionValid(version) || entry?.specifier !== version || entry.version !== version || !pins.has(`${name}@${version}`)) return invalid("\u4F9D\u8D56\u58F0\u660E\u4E0E\u6839\u9501\u56FE\u4E0D\u4E00\u81F4\u3002");
    roots[name] = `${name}@${version}`;
  }
  if (Object.keys(lock.importers["."].dependencies).length !== Object.keys(roots).length) return invalid("\u6839\u9501\u56FE\u5305\u542B\u672A\u58F0\u660E\u4F9D\u8D56\u3002");
  const graph = /* @__PURE__ */ new Map();
  function visit(id) {
    if (graph.has(id)) return;
    const pin = pins.get(id), snapshot = lock.snapshots[id];
    if (!pin || !record(snapshot) || Object.keys(snapshot).some((k) => k !== "dependencies") || snapshot.dependencies !== void 0 && !record(snapshot.dependencies)) return invalid("\u4F20\u9012\u9501\u56FE\u4E0D\u5B8C\u6574\u3002");
    const bytes = store.get(integrityKey(pin.integrity));
    if (!bytes) throw new DependencyError("DEPENDENCY_UNAVAILABLE", `\u79BB\u7EBF\u5E93\u7F3A\u5C11 ${id}\uFF1B\u8BF7\u663E\u5F0F\u534F\u8C03\u4F9D\u8D56\u3002`);
    const { manifest: meta } = unpackOfflinePackage(bytes, pin);
    const edges = /* @__PURE__ */ Object.create(null);
    const required = { ...meta.dependencies, ...meta.optionalDependencies, ...meta.peerDependencies };
    for (const [name, range] of Object.entries(required)) {
      const version = snapshot.dependencies?.[name];
      if (version === void 0 && meta.peerDependenciesMeta?.[name]?.optional === true && !meta.dependencies?.[name] && !meta.optionalDependencies?.[name]) continue;
      if (!nameValid(name) || !versionValid(version) || typeof range !== "string" || !(0, import_semver.validRange)(range) || !(0, import_semver.satisfies)(version, range)) return invalid("\u4F20\u9012\u4F9D\u8D56\u4E0E\u5305\u58F0\u660E\u4E0D\u4E00\u81F4\u3002");
      edges[name] = `${name}@${version}`;
    }
    if (Object.keys(snapshot.dependencies ?? {}).some((name) => !Object.hasOwn(edges, name))) return invalid("\u4F20\u9012\u9501\u56FE\u542B\u5305\u672A\u58F0\u660E\u7684\u4F9D\u8D56\u3002");
    graph.set(id, { pin, bytes: Buffer.from(bytes), dependencies: edges });
    for (const target of Object.values(edges)) visit(target);
  }
  Object.values(roots).forEach(visit);
  if (graph.size !== pins.size || Object.keys(lock.snapshots).length !== graph.size) return invalid("\u9501\u56FE\u5305\u542B\u672A\u5F15\u7528\u5305\u6216\u591A\u4F59\u5FEB\u7167\u3002");
  return { roots, graph };
}

// src/server/program-toolchain.ts
import { readFile as readFile3, readdir as readdir3 } from "node:fs/promises";
import { createRequire as createToolchainRequire } from "node:module";
import { dirname as dirname4, join as join5 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var require2 = createToolchainRequire(import.meta.url);
var applicationRoot = join5(dirname4(fileURLToPath2(import.meta.url)), "../..");
async function programToolchain() {
  const files = /* @__PURE__ */ Object.create(null);
  const packages = /* @__PURE__ */ new Map();
  async function readTree2(root, prefix, collected, relative4 = "") {
    for (const item of await readdir3(join5(root, relative4), { withFileTypes: true })) {
      if (item.name === "node_modules" || item.name.endsWith(".map")) continue;
      const path = relative4 ? `${relative4}/${item.name}` : item.name;
      if (item.isDirectory()) await readTree2(root, prefix, collected, path);
      else if (item.isFile()) {
        const bytes = await readFile3(join5(root, path));
        files[`${prefix}/${path}`] = bytes;
        collected?.set(path, bytes);
      } else throw new Error("\u56FA\u5B9A\u5DE5\u5177\u94FE\u5185\u542B\u4E0D\u652F\u6301\u7684\u94FE\u63A5\u3002");
    }
  }
  for (const name of ["react", "react-dom", "scheduler", "remotion", "@remotion/player", "@types/react", "@types/react-dom", "csstype"]) {
    const resolver = name === "scheduler" ? createToolchainRequire(require2.resolve("react-dom/package.json")) : name === "csstype" ? createToolchainRequire(require2.resolve("@types/react/package.json")) : require2;
    const root = dirname4(resolver.resolve(`${name}/package.json`));
    const collected = /* @__PURE__ */ new Map();
    await readTree2(root, `modules/${name}`, collected);
    packages.set(name, { version: JSON.parse(collected.get("package.json").toString()).version, files: collected });
  }
  const esbuildRequire = createToolchainRequire(require2.resolve("esbuild/package.json"));
  files["toolchain/esbuild"] = await readFile3(esbuildRequire.resolve(`@esbuild/${process.platform}-${process.arch}/bin/esbuild`));
  const tsRequire = createToolchainRequire(require2.resolve("typescript/package.json"));
  const tsRoot = dirname4(tsRequire.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`));
  await readTree2(join5(tsRoot, "lib"), "toolchain/tsc");
  files["modules/@narracut/runtime/index.ts"] = await readFile3(join5(applicationRoot, "src/runtime/index.ts"));
  files["modules/@narracut/runtime/package.json"] = Buffer.from(JSON.stringify({ name: "@narracut/runtime", version: "4.0.512", main: "index.ts", types: "index.ts" }));
  files["worker.mjs"] = await bundleApplicationWorker("build");
  return { files, packages };
}
async function bundleApplicationWorker(stage) {
  const { build } = require2("esbuild");
  const worker = await build({
    entryPoints: [join5(applicationRoot, `src/server/program-${stage}-worker.ts`)],
    absWorkingDir: applicationRoot,
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    banner: { js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);' }
  });
  return Buffer.from(worker.outputFiles[0].contents);
}

// src/server/program-runtime-source.ts
var PROGRAM_RUNTIME_SOURCE = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Composition, registerRoot, Sequence, Audio, useCurrentFrame} from 'remotion';
import {Player} from '@remotion/player';
import {RenderProgram} from '../program/src/RenderProgram';
import {bindAssets} from './safe-jsx';
function freeze(value) { if(value && typeof value==='object') {Object.values(value).forEach(freeze);Object.freeze(value);} return value; }
let committed=false, player=null, bridge=null, frame=0, buffering=false, pending=null, frameSequence=0;
function emit(type,extra={}) {if(bridge)parent.postMessage({version:1,instanceId:bridge.instanceId,token:bridge.token,type,...extra},bridge.parentOrigin);}
function reportFrame(){const current=frame, seq=++frameSequence;queueMicrotask(()=>{if(seq!==frameSequence||buffering||!bridge)return;const requestId=pending?.frame===current?pending.id:undefined;if(requestId)pending=null;emit('FRAME',{frame:current,requestId});});}
function FrameCommit(){const current=useCurrentFrame();React.useLayoutEffect(()=>{frame=current;reportFrame();},[current]);return null;}
function attachPlayer(ref){player=ref;if(!ref)return;for(const [event,type] of [['play','PLAYING'],['pause','PAUSED'],['ended','PAUSED']])ref.addEventListener(event,()=>emit(type));ref.addEventListener('volumechange',e=>emit('VOLUME',{volume:e.detail.volume}));ref.addEventListener('mutechange',e=>emit('MUTE',{muted:e.detail.isMuted}));ref.addEventListener('waiting',()=>{buffering=true;emit('BUFFERING',{buffering:true});});ref.addEventListener('resume',()=>{buffering=false;emit('BUFFERING',{buffering:false});reportFrame();});}
function Visual({input}) { const visual=RenderProgram(input); React.useLayoutEffect(()=>{committed=true;},[]); return visual; }
function Video({input,speech}) { return <><Visual input={input}/><FrameCommit/>{speech.map(s=><Sequence key={s.sceneId} from={s.startFrame} durationInFrames={s.durationInFrames} layout="none"><Audio src={s.src}/></Sequence>)}</>; }
let binding;
function Root() { if(!binding || binding.input.scenes.length===0) return null; const {input,speech}=binding; return <Composition id="Narracut" component={Video} width={input.output.width} height={input.output.height} fps={input.output.fps} durationInFrames={input.durationInFrames} defaultProps={{input,speech}}/>; }
registerRoot(Root);
class Boundary extends React.Component { componentDidCatch(){window.__narracutCheck={code:'RUNTIME_FRAME_FAILED'};emit('ERROR',{code:'RUNTIME_FRAME_FAILED'});} render(){return this.props.children;} }
Object.defineProperty(window,'__narracutBind',{configurable:true,value:(input,speech)=>{
  if(binding) throw new Error('Runtime \u53EA\u5141\u8BB8\u7ED1\u5B9A\u4E00\u6B21');
  if(typeof RenderProgram!=='function') throw new Error('RUNTIME_ENTRY_INVALID');
  binding=freeze(JSON.parse(JSON.stringify({input,speech})));
  const frozen=binding.input;
  bindAssets(frozen.assets.filter(asset=>asset.availability==='available').map(asset=>asset.src));
  const metadata={id:'Narracut',...frozen.output,durationInFrames:frozen.durationInFrames,sceneCount:frozen.scenes.length};
  if(frozen.scenes.length===0){ window.__narracutCheck={metadata,runtime:'not-applicable'};return; }
  const composition=Root();
  if(composition.type!==Composition || composition.props.durationInFrames!==frozen.durationInFrames)throw new Error('COMPOSITION_INVALID');
  const root=createRoot(document.getElementById('root'));
  root.render(<Boundary><Player ref={attachPlayer} style={{width:"100%",height:"100%"}} component={Video} inputProps={binding} compositionWidth={frozen.output.width} compositionHeight={frozen.output.height} fps={frozen.output.fps} durationInFrames={frozen.durationInFrames} controls={false} autoPlay={false} initialFrame={0} errorFallback={()=>{window.__narracutCheck={code:'RUNTIME_FRAME_FAILED'};emit('ERROR',{code:'RUNTIME_FRAME_FAILED'});return null;}}/></Boundary>);
  function ready(){if(window.__narracutCheck)return;if(committed)window.__narracutCheck={metadata,runtime:'passed'};else requestAnimationFrame(ready);}requestAnimationFrame(ready);
}});
window.addEventListener('narracut-preview-binding',event=>{
  if(bridge||binding)return;
  const prepared=freeze(event.detail);let initialized=false,closed=false;
  function fail(code){emit('ERROR',{code});closed=true;player?.pause();document.getElementById('root').replaceChildren();}
  bridge=prepared;
  window.addEventListener('message',event=>{
    const m=event.data;
    if(closed||event.source!==parent||event.origin!==prepared.parentOrigin||!m||m.instanceId!==prepared.instanceId||m.token!==prepared.token)return;
    if(m.version!==1){fail('BRIDGE_VERSION_UNSUPPORTED');return;}
    if(m.type==='INIT'){
      if(initialized){fail('BRIDGE_ALREADY_BOUND');return;}
      if(JSON.stringify(m.identity)!==JSON.stringify(prepared.identity)){fail('BRIDGE_IDENTITY_MISMATCH');return;}
      initialized=true;
      try{window.__narracutBind(prepared.input,prepared.speech);delete window.__narracutBind;}catch{fail('BRIDGE_INIT_FAILED');return;}
      function ready(){if(closed)return;if(window.__narracutCheck?.code){fail(window.__narracutCheck.code);return;}if(window.__narracutCheck){emit('READY',{identity:prepared.identity});if(prepared.input.scenes.length)reportFrame();}else requestAnimationFrame(ready);}requestAnimationFrame(ready);
      return;
    }
    if(!initialized||!player)return;
    if(m.type==='PLAY')player.play();
    else if(m.type==='PAUSE')player.pause();
    else if(m.type==='SEEK'&&Number.isSafeInteger(m.frame)&&m.frame>=0&&m.frame<prepared.input.durationInFrames&&typeof m.requestId==='string'){
      player.pause();pending={frame:m.frame,id:m.requestId};player.seekTo(m.frame);if(frame===m.frame)reportFrame();
    }else if(m.type==='VOLUME'&&Number.isFinite(m.volume)&&m.volume>=0&&m.volume<=1)player.setVolume(m.volume);
    else if(m.type==='MUTE'&&typeof m.muted==='boolean')m.muted?player.mute():player.unmute();
    else fail('BRIDGE_COMMAND_INVALID');
  });
  window.addEventListener('error',()=>fail('RUNTIME_FRAME_FAILED'));
  emit('BOOT');
},{once:true});

`;
var PROGRAM_ENTRY_CONTRACT = `
import type {ReactNode} from 'react';
import type {RenderProgramInputV1} from '@narracut/runtime';
import {RenderProgram} from '../program/src/RenderProgram';
const entry: (input: RenderProgramInputV1) => ReactNode = RenderProgram;
void entry;
`;
var PROGRAM_SAFE_JSX = `
import {jsx as original, jsxs as originals, Fragment} from 'react/jsx-runtime';
export {Fragment};
let sources;
export function bindAssets(values){if(sources)throw new Error('\u91CD\u590D\u5A92\u4F53\u7ED1\u5B9A');sources=new Set(values);}
const tags=new Set('div span p h1 h2 h3 h4 h5 h6 section article header footer main strong em b i small br hr ul ol li svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask use img'.split(' '));
export function check(type,props){
  if(typeof type==='string'&&!tags.has(type))throw new Error('STATIC_FORBIDDEN_CAPABILITY');
  for(const [key,value] of Object.entries(props||{})){
    if(/^on/i.test(key)||['ref','dangerouslySetInnerHTML','srcDoc','innerHTML'].includes(key))throw new Error('STATIC_FORBIDDEN_CAPABILITY');
    if(key==='style')for(const [name,text] of Object.entries(value||{}))if(/animation|transition/i.test(name)||/url\\s*\\(|@import|expression\\s*\\(/i.test(String(text)))throw new Error('STATIC_NONDETERMINISTIC_API');
    if(['href','src','xlinkHref'].includes(key)&&typeof value==='string'&&!value.startsWith('#')&&!sources?.has(value))throw new Error('STATIC_FORBIDDEN_CAPABILITY');
  }
}
export function jsx(type,props,key){check(type,props);return original(type,props,key);}
export function jsxs(type,props,key){check(type,props);return originals(type,props,key);}
`;
var PROGRAM_SAFE_REMOTION = `
export {interpolate,interpolateColors,spring,Easing,useCurrentFrame} from 'remotion';
import React from 'react';
import {AbsoluteFill as Fill,Sequence as Seq,Series as Ser,Img as Image} from 'remotion';
import {check} from './safe-jsx';
function component(Type){return function SafeComponent(props){check(Type,props);return React.createElement(Type,props);};}
export const AbsoluteFill=component(Fill),Sequence=component(Seq),Img=component(Image);
export const Series=Object.assign(component(Ser),{Sequence:component(Ser.Sequence)});
import {random as original,useVideoConfig as originalConfig} from 'remotion';
export function useVideoConfig(){const {width,height,fps,durationInFrames}=originalConfig();return Object.freeze({width,height,fps,durationInFrames});}
export function random(seed){if(typeof seed!=='string'&&!(typeof seed==='number'&&Number.isFinite(seed)))throw new Error('STATIC_NONDETERMINISTIC_API');return original(seed);}
`;

// src/server/program-bundle.ts
var ProgramBuildError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
function checkProgramManifest(bytes) {
  let value;
  try {
    if (!bytes || bytes.byteLength > 65536) throw new Error();
    value = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), {
      maxDepth: 16,
      maxArrayItems: 1024,
      maxObjectFields: 1024,
      maxNodes: 4096,
      maxStringScalars: 65536,
      maxStringBytes: 65536,
      maxNumberBytes: 32
    });
  } catch {
    throw new ProgramBuildError("MANIFEST_INVALID", "program.json \u5FC5\u987B\u662F\u65E0\u91CD\u590D\u5B57\u6BB5\u7684\u9759\u6001 UTF-8 JSON\u3002");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger(value.apiVersion)) {
    throw new ProgramBuildError("MANIFEST_INVALID", "Manifest \u5FC5\u987B\u663E\u5F0F\u58F0\u660E\u6574\u6570 apiVersion \u548C Output Format\u3002");
  }
  if (value.apiVersion !== 1) throw new ProgramBuildError("MANIFEST_API_UNSUPPORTED", "\u53EA\u652F\u6301 Render Program \u534F\u8BAE\u4E3B\u7248\u672C 1\u3002");
  if (!value.output || !["width", "height", "fps"].every((key) => Number.isSafeInteger(value.output[key]) && value.output[key] > 0)) {
    throw new ProgramBuildError("OUTPUT_FORMAT_INVALID", "width\u3001height\u3001fps \u5FC5\u987B\u663E\u5F0F\u58F0\u660E\u4E3A\u6B63\u5B89\u5168\u6574\u6570\u3002");
  }
  return {
    apiVersion: 1,
    output: Object.freeze({ width: value.output.width, height: value.output.height, fps: value.output.fps }),
    warnings: Object.keys(value).some((key) => !["apiVersion", "output"].includes(key)) || Object.keys(value.output).some((key) => !["width", "height", "fps"].includes(key)) ? ["MANIFEST_UNKNOWN_FIELD"] : []
  };
}
function fingerprint(files) {
  const hash2 = createHash6("sha256");
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    hash2.update(JSON.stringify([path, bytes.byteLength]) + "\n");
    hash2.update(bytes);
  }
  return `sha256:${hash2.digest("hex")}`;
}
var ImmutableProgramBundle = class {
  constructor(files, environmentIdentity, programIdentity, inputIdentity, runtime, warnings) {
    this.environmentIdentity = environmentIdentity;
    this.programIdentity = programIdentity;
    this.inputIdentity = inputIdentity;
    this.runtime = runtime;
    this.warnings = warnings;
    this.#files = new Map([...files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
    this.identity = fingerprint(this.#files);
    this.warnings = Object.freeze([...warnings]);
    Object.freeze(this);
  }
  environmentIdentity;
  programIdentity;
  inputIdentity;
  runtime;
  warnings;
  identity;
  #files;
  files() {
    return new Map([...this.#files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  }
};
function checkBinding(input, speech, output) {
  const invalid = () => {
    throw new ProgramBuildError("RUNTIME_CONTRACT_VIOLATION", "\u8F93\u5165\u3001Scene \u65F6\u95F4\u7A97\u3001Output Format \u6216\u6743\u5A01 Speech \u4E0D\u4E00\u81F4\u3002");
  };
  if (input.apiVersion !== 1 || !["width", "height", "fps"].every((key) => input.output[key] === output[key]) || !Array.isArray(input.scenes) || !Array.isArray(speech)) invalid();
  let frame = 0;
  const ids = /* @__PURE__ */ new Set();
  for (const scene of input.scenes) {
    if (ids.has(scene.id) || scene.time.startFrame !== frame || !Number.isSafeInteger(scene.time.durationInFrames) || scene.time.durationInFrames <= 0) invalid();
    ids.add(scene.id);
    frame += scene.time.durationInFrames;
    const tracks = speech.filter((track) => track.sceneId === scene.id);
    if (scene.time.source === "speech") {
      if (tracks.length !== 1 || tracks[0].startFrame !== scene.time.startFrame || tracks[0].durationInFrames !== scene.time.durationInFrames || !tracks[0].src) invalid();
    } else if (scene.time.source !== "draft" || tracks.length) invalid();
  }
  if (!Number.isSafeInteger(frame) || frame !== input.durationInFrames || speech.some((track) => !ids.has(track.sceneId))) invalid();
}
async function buildProgramBundle(request) {
  const program = new Map([...request.program].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  const offline = new Map([...request.offline].map(([key, bytes]) => [key, Buffer.from(bytes)]));
  const binding = JSON.parse(JSON.stringify({ input: request.input, speech: request.speech }));
  const manifest = checkProgramManifest(program.get("program.json"));
  checkBinding(binding.input, binding.speech, manifest.output);
  for (const path of program.keys()) if (!/^(?:src\/|resources\/|program\.json$|package\.json$|pnpm-lock\.yaml$)/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..") || /[\\\0]/.test(path)) throw new ProgramBuildError("BUNDLE_FAILED", "\u5019\u9009\u5305\u542B\u4E0D\u652F\u6301\u7684\u8DEF\u5F84\u6216\u6784\u5EFA\u914D\u7F6E\u3002");
  if (!program.has("src/RenderProgram.tsx")) throw new ProgramBuildError("RUNTIME_ENTRY_INVALID", "\u7F3A\u5C11\u56FA\u5B9A\u5165\u53E3 src/RenderProgram.tsx\u3002");
  if (!program.has("package.json") || !program.has("pnpm-lock.yaml")) throw new ProgramBuildError("DEPENDENCY_LOCK_INVALID", "\u4F9D\u8D56\u58F0\u660E\u6216\u9501\u6587\u4EF6\u7F3A\u5931\u3002");
  const dependencies = readOfflineDependencyGraph(program.get("package.json"), program.get("pnpm-lock.yaml"), offline);
  const capsule = await localExecutionCapsule();
  const capsuleIdentity = await capsule.certify();
  const toolchain = await programToolchain();
  const pins = [...dependencies.graph];
  const index = new Map(pins.map(([id], index2) => [id, index2]));
  const packages = pins.map(([, item]) => ({ pin: item.pin, dependencies: Object.fromEntries(Object.entries(item.dependencies).map(([name, id]) => [name, index.get(id)])) }));
  const roots = Object.fromEntries(Object.entries(dependencies.roots).map(([name, id]) => [name, index.get(id)]));
  const failOutput = (files) => {
    if (files.has("failure.json")) {
      const { code } = JSON.parse(files.get("failure.json").toString());
      const allowed = ["TYPECHECK_FAILED", "BUNDLE_FAILED", "DEPENDENCY_INSTALL_FAILED", "STATIC_FORBIDDEN_CAPABILITY", "STATIC_NONDETERMINISTIC_API"];
      throw new ProgramBuildError(allowed.includes(code) ? code : "BUNDLE_FAILED", "\u5019\u9009\u68C0\u67E5\u672A\u901A\u8FC7\uFF1B\u8BF7\u4FEE\u590D\u6E90\u7801\u6216\u4F9D\u8D56\u540E\u91CD\u8BD5\u3002");
    }
    return true;
  };
  const installed = await capsule.run({ stage: "install", entry: "dependencies/worker.mjs", signal: request.signal, inputs: {
    "dependencies/worker.mjs": toolchain.files["worker.mjs"],
    "dependencies/config.json": Buffer.from(JSON.stringify({ stage: "install", packages })),
    ...Object.fromEntries(pins.map(([, item], index2) => [`dependencies/${index2}.tgz`, item.bytes]))
  } }, (files) => failOutput(files) && [...files.keys()].every((path) => /^packages\/\d+\//.test(path) && Number(path.split("/")[1]) < packages.length));
  const trustedFiles = [];
  for (const [i, [, item]] of pins.entries()) {
    const fixed = toolchain.packages.get(item.pin.name);
    if (!fixed) continue;
    if (item.pin.version !== fixed.version) throw new ProgramBuildError("DEPENDENCY_LOCK_INVALID", "\u6838\u5FC3\u4F9D\u8D56\u5FC5\u987B\u4E0E\u56FA\u5B9A\u5DE5\u5177\u94FE\u7248\u672C\u4E00\u81F4\u3002");
    const actual = [...installed].filter(([path]) => path.startsWith(`packages/${i}/`));
    for (const [path, bytes] of actual) {
      const relative4 = path.slice(`packages/${i}/`.length);
      if (relative4.endsWith(".map")) continue;
      if (!fixed.files.get(relative4)?.equals(bytes)) throw new ProgramBuildError("DEPENDENCY_INTEGRITY_FAILED", "\u6838\u5FC3\u4F9D\u8D56\u5B57\u8282\u4E0E\u56FA\u5B9A Runtime \u4E0D\u4E00\u81F4\u3002");
      trustedFiles.push(`/tmp/work/${path}`);
    }
    if ([...fixed.files.keys()].some((path) => !installed.has(`packages/${i}/${path}`))) throw new ProgramBuildError("DEPENDENCY_INTEGRITY_FAILED", "\u6838\u5FC3\u4F9D\u8D56\u7F3A\u5C11\u56FA\u5B9A Runtime \u6587\u4EF6\u3002");
  }
  const config = Buffer.from(JSON.stringify({ stage: "build", packages, roots, trustedFiles }));
  const runtimeFiles = { ...toolchain.files, "config.json": config, "source/entry.tsx": Buffer.from(PROGRAM_RUNTIME_SOURCE), "source/entry-contract.ts": Buffer.from(PROGRAM_ENTRY_CONTRACT), "source/safe-jsx.ts": Buffer.from(PROGRAM_SAFE_JSX), "source/safe-remotion.ts": Buffer.from(PROGRAM_SAFE_REMOTION), "launch.mjs": Buffer.from("process.env.ESBUILD_BINARY_PATH='/tmp/tools/esbuild';await import('./worker.mjs');") };
  const metadataDriver = await bundleApplicationWorker("metadata");
  const environmentIdentity = fingerprint(new Map([...Object.entries(runtimeFiles).filter(([path]) => path !== "config.json"), ["capsule", Buffer.from(capsuleIdentity)], ["metadata-worker", metadataDriver]]));
  const bundle = await capsule.run({ stage: "build", entry: "runtime/launch.mjs", signal: request.signal, inputs: {
    ...Object.fromEntries([...program].map(([path, bytes]) => [`program/${path}`, bytes])),
    ...Object.fromEntries([...installed].map(([path, bytes]) => [`dependencies/${path}`, bytes])),
    ...Object.fromEntries(Object.entries(runtimeFiles).map(([path, bytes]) => [`runtime/${path}`, bytes]))
  } }, (files) => {
    failOutput(files);
    if (!files.has("bundle.js.map")) throw new ProgramBuildError("BUNDLE_SOURCEMAP_MISSING", "\u6784\u5EFA\u7F3A\u5C11\u5B8C\u6574 Source Map\u3002");
    return files.size === 3 && files.has("bundle.js") && files.has("index.html") && JSON.parse(files.get("bundle.js.map").toString()).version === 3;
  });
  const metadata = await capsule.run({ stage: "metadata", entry: "bundle/metadata.mjs", signal: request.signal, inputs: {
    ...Object.fromEntries([...bundle].map(([path, bytes]) => [`bundle/${path}`, bytes])),
    "bundle/metadata.mjs": metadataDriver,
    "input/binding.json": Buffer.from(JSON.stringify(binding))
  } }, (files) => {
    if (files.size !== 1 || !files.has("metadata.json")) return false;
    const value = JSON.parse(files.get("metadata.json").toString());
    if (value.code) throw new ProgramBuildError("RUNTIME_METADATA_INVALID", "\u5019\u9009\u672A\u901A\u8FC7\u79BB\u7EBF Runtime \u68C0\u67E5\u3002");
    const expected = { id: "Narracut", ...manifest.output, durationInFrames: binding.input.durationInFrames, sceneCount: binding.input.scenes.length };
    if (JSON.stringify(value.metadata) !== JSON.stringify(expected) || value.runtime !== (binding.input.scenes.length ? "passed" : "not-applicable")) throw new ProgramBuildError("COMPOSITION_INVALID", "Composition \u4E0E Runtime \u6743\u5A01\u8F93\u5165\u4E0D\u4E00\u81F4\u3002");
    return true;
  });
  return new ImmutableProgramBundle(
    bundle,
    environmentIdentity,
    fingerprint(program),
    fingerprint(/* @__PURE__ */ new Map([["binding", Buffer.from(JSON.stringify(binding))]])),
    JSON.parse(metadata.get("metadata.json").toString()).runtime,
    manifest.warnings
  );
}

// src/server/render-program-input.ts
function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function createRenderProgramInput(state, output, assetSources) {
  if (![output.width, output.height, output.fps].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Output Format \u7684 width\u3001height \u4E0E fps \u5FC5\u987B\u662F\u6B63\u5B89\u5168\u6574\u6570\u3002");
  }
  const speechStates = new Map(state.speechStates.map((speech) => [speech.sceneId, speech]));
  const timeline = deriveSceneTimeWindows(state.project.scenes.map((scene) => {
    const speech = speechStates.get(scene.id);
    if (speech?.status === "available") {
      const durationMs = speech.durationMs;
      if (durationMs === void 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
        throw new Error(`Scene ${scene.id} \u7684\u53EF\u7528 Speech \u7F3A\u5C11\u6709\u6548\u5B9E\u9645\u65F6\u957F\u3002`);
      }
      return { sceneId: scene.id, durationMs, source: "speech" };
    }
    return { sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" };
  }), output.fps);
  if (!Number.isSafeInteger(timeline.durationInFrames)) {
    throw new Error("\u9879\u76EE\u603B\u5E27\u6570\u8D85\u8FC7\u53EF\u7CBE\u786E\u8868\u793A\u7684\u6574\u6570\u8303\u56F4\u3002");
  }
  const referenced = new Set(state.project.scenes.flatMap((scene) => scene.assetIds));
  const assetStates = new Map(state.assetStates.map((asset) => [asset.id, asset]));
  return deepFreeze({
    apiVersion: 1,
    videoBrief: state.videoBrief,
    output: { width: output.width, height: output.height, fps: output.fps },
    durationInFrames: timeline.durationInFrames,
    scenes: state.project.scenes.map((scene, index) => {
      const time = timeline.scenes[index];
      return {
        id: scene.id,
        narration: scene.narration.text,
        assetIds: [...scene.assetIds],
        time: { startFrame: time.startFrame, durationInFrames: time.durationInFrames, source: time.source }
      };
    }),
    assets: state.project.assets.filter((asset) => referenced.has(asset.id)).map((asset) => {
      if (assetStates.get(asset.id)?.status !== "available") {
        return { id: asset.id, path: asset.path, availability: "unavailable" };
      }
      const src = assetSources.get(asset.id);
      if (!src) throw new Error(`\u53EF\u7528 Asset ${asset.id} \u7F3A\u5C11 Runtime \u8BFB\u53D6\u5730\u5740\u3002`);
      return { id: asset.id, path: asset.path, availability: "available", src };
    })
  });
}

// src/server/preview-origin.ts
import { createServer } from "node:http";
import { createHash as createHash7, randomBytes, randomUUID as randomUUID3 } from "node:crypto";
var previewDigest = (value) => `sha256:${createHash7("sha256").update(value).digest("hex")}`;
var CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin";
var PreviewOrigin = class {
  #server;
  #starting;
  #origin = "";
  #instances = /* @__PURE__ */ new Map();
  origin() {
    return this.#starting ??= new Promise((resolve4, reject) => {
      this.#server = createServer((req, res) => {
        res.setHeader("Content-Security-Policy", CSP);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
        if (req.headers.host !== new URL(this.#origin).host) {
          res.writeHead(403).end();
          return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405).end();
          return;
        }
        const path = (req.url ?? "").split("?")[0];
        const match = /^\/([a-f0-9]{48})\/(index.html|bundle.js|bootstrap.js|media\/[a-f0-9]{64})$/.exec(path);
        const bytes = match && this.#instances.get(match[1])?.get(match[2]);
        if (!bytes) {
          res.writeHead(404).end();
          return;
        }
        const type = match[2].endsWith(".html") ? "text/html; charset=utf-8" : match[2].endsWith(".js") ? "text/javascript; charset=utf-8" : "application/octet-stream";
        res.setHeader("Content-Type", type);
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
        let start = 0, end = bytes.length - 1;
        if (range) {
          start = Number(range[1]);
          end = range[2] ? Number(range[2]) : end;
          if (start > end || end >= bytes.length) {
            res.writeHead(416).end();
            return;
          }
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
        }
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", end - start + 1);
        res.end(req.method === "HEAD" ? void 0 : bytes.subarray(start, end + 1));
      });
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", () => {
        this.#origin = `http://127.0.0.1:${this.#server.address().port}`;
        this.#server.unref();
        resolve4(this.#origin);
      });
    });
  }
  async publish(args) {
    const origin = await this.origin();
    if (!/^https?:\/\//.test(args.parentOrigin) || new URL(args.parentOrigin).origin !== args.parentOrigin || args.parentOrigin === origin) throw new Error("Preview \u9700\u8981\u53EF\u9A8C\u8BC1\u7684\u8DE8 origin \u5BBF\u4E3B\u3002");
    const bindingBytes = Buffer.from(JSON.stringify({ input: args.input, speech: args.speech }));
    const boundIdentity = previewDigest(Buffer.concat([Buffer.from(JSON.stringify(["binding", bindingBytes.length]) + "\n"), bindingBytes]));
    if (boundIdentity !== args.bundle.inputIdentity) throw new Error("Preview \u8F93\u5165\u4E0E Bundle \u6784\u5EFA\u7ED1\u5B9A\u4E0D\u4E00\u81F4\u3002");
    const identity2 = { bundle: args.bundle.identity, input: args.bundle.inputIdentity, media: previewDigest(JSON.stringify([...args.media].map(([path, bytes]) => [path, previewDigest(bytes)]).sort())), environment: args.bundle.environmentIdentity };
    const instanceId = randomUUID3(), token = randomBytes(32).toString("hex");
    if (!/^[a-f0-9]{48}$/.test(args.key) || this.#instances.has(args.key)) throw new Error("Preview \u5B9E\u4F8B\u4E0D\u80FD\u91CD\u590D\u7ED1\u5B9A\u3002");
    const files = /* @__PURE__ */ new Map([["bundle.js", args.bundle.files().get("bundle.js")]]);
    for (const [path, bytes] of args.media) {
      if (!/^media\/[a-f0-9]{64}$/.test(path) || path !== `media/${previewDigest(bytes).slice(7)}`) throw new Error("\u5A92\u4F53\u8DEF\u5F84\u65E0\u6548\u3002");
      files.set(path, Buffer.from(bytes));
    }
    for (const src of [...args.input.assets.filter((asset) => asset.availability === "available").map((asset) => asset.src), ...args.speech.map((track) => track.src)]) {
      if (!src || !files.has(src)) throw new Error("Preview \u7F3A\u5C11\u7ED1\u5B9A\u7684\u4E0D\u53EF\u53D8\u5A92\u4F53\u3002");
    }
    const binding = { instanceId, token, identity: identity2, parentOrigin: args.parentOrigin, input: args.input, speech: args.speech };
    files.set("bootstrap.js", Buffer.from(`window.dispatchEvent(new CustomEvent('narracut-preview-binding',{detail:${JSON.stringify(binding)}}));`));
    files.set("index.html", Buffer.from('<!doctype html><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#050707}#root{display:flex;align-items:center;justify-content:center}</style><div id="root"></div><script src="bundle.js"></script><script src="bootstrap.js"></script>'));
    this.#instances.set(args.key, files);
    return { version: 1, instanceId, token, identity: identity2, input: args.input, target: args.target, baseline: args.baseline, label: args.label, origin, url: `${origin}/${args.key}/index.html` };
  }
  release(url) {
    const key = new URL(url).pathname.split("/")[1];
    this.#instances.delete(key);
  }
  async close() {
    this.#instances.clear();
    if (this.#server) {
      this.#server.closeAllConnections();
      await new Promise((resolve4) => this.#server.close(() => resolve4()));
    }
  }
};

// src/server/project-preview.ts
async function snapshotFile(root, path, limit) {
  const full = join6(root, path), resolved = await realpath3(full), rel = relative2(await realpath3(root), resolved);
  if (rel.startsWith("..") || isAbsolute2(rel) || (await lstat3(full)).isSymbolicLink()) throw new Error("Preview \u6587\u4EF6\u8D8A\u8FC7\u9879\u76EE\u8FB9\u754C\u3002");
  const expected = await lstat3(resolved);
  const file = await open3(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.dev !== expected.dev || before.ino !== expected.ino || await realpath3(full) !== resolved || before.size > limit) throw new Error("Preview \u6587\u4EF6\u4E0D\u53EF\u7528\u6216\u8D85\u8FC7\u5185\u5B58\u4E0A\u9650\u3002");
    const bytes = await file.readFile();
    const after = await file.stat();
    if (await realpath3(full) !== resolved || bytes.length > limit || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Preview \u8BFB\u53D6\u671F\u95F4\u5A92\u4F53\u53D1\u751F\u53D8\u5316\u3002");
    return bytes;
  } finally {
    await file.close();
  }
}
var ProjectPreview = class {
  source = new PreviewOrigin();
  #active = /* @__PURE__ */ new Map();
  async capture(opened, target) {
    const root = opened.inspection.projectDirectory;
    const state = await inspectProjectVNext(root);
    if (state.manifest.projectId !== opened.inspection.manifest.projectId) throw new Error("\u9879\u76EE\u8EAB\u4EFD\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u3002");
    const candidate = await opened.candidate({ action: "read" });
    const source = await opened.readPreviewSource(target);
    const manifest = source.manifest;
    const output = checkProgramManifest(manifest).output;
    const media = /* @__PURE__ */ new Map(), assetSources = /* @__PURE__ */ new Map();
    let total = 0;
    async function add(path) {
      const bytes = await snapshotFile(root, path, 256 * 1024 * 1024);
      total += bytes.length;
      if (total > 512 * 1024 * 1024) throw new Error("Preview \u5A92\u4F53\u8D85\u8FC7 512 MiB\uFF0C\u8BF7\u7F29\u5C0F\u7D20\u6750\u540E\u91CD\u8BD5\u3002");
      const key = `media/${previewDigest(bytes).slice(7)}`;
      media.set(key, bytes);
      return key;
    }
    const referenced = new Set(state.project.scenes.flatMap((scene) => scene.assetIds));
    for (const asset of state.assetStates) if (referenced.has(asset.id) && asset.status === "available") assetSources.set(asset.id, await add(asset.path));
    const input = createRenderProgramInput(state, output, assetSources);
    const speech = [];
    for (const scene of input.scenes) if (scene.time.source === "speech") {
      const source2 = state.project.scenes.find((item) => item.id === scene.id).speech;
      speech.push({ sceneId: scene.id, startFrame: scene.time.startFrame, durationInFrames: scene.time.durationInFrames, src: await add(source2.path) });
    }
    const signature = previewDigest(JSON.stringify([state.projectRevision, state.videoBriefRevision, target === "candidate" ? candidate.baseline : source.revision, source.identity, manifest.toString(), [...media.keys()].sort(), input, speech]));
    return { input, speech, media, signature, baseline: candidate.baseline, sourceIdentity: source.identity, revision: source.revision, candidate };
  }
  async build(opened, target, parentOrigin) {
    if (this.#active.size >= 4) throw new Error("Preview \u5B9E\u4F8B\u5DF2\u8FBE\u4E0A\u9650\uFF0C\u8BF7\u5173\u95ED\u9690\u85CF\u5B9E\u4F8B\u540E\u91CD\u8BD5\u3002");
    const before = await this.capture(opened, target);
    const bundle = await opened.buildCandidateBundle({ input: before.input, speech: before.speech, baseline: before.baseline, sourceIdentity: before.sourceIdentity, target });
    const after = await this.capture(opened, target);
    if (before.signature !== after.signature) throw new Error("\u6784\u5EFA\u671F\u95F4\u8F93\u5165\u6216\u5A92\u4F53\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    const descriptor = await this.source.publish({ ...before, bundle, target, parentOrigin, key: randomBytes2(24).toString("hex"), label: target === "candidate" ? `\u5019\u9009 \xB7 ${before.candidate.candidate.identity.slice(7, 15)}` : `\u5F53\u524D \xB7 ${before.revision.slice(0, 8)}` });
    this.#active.set(descriptor.instanceId, { descriptor, signature: before.signature });
    return descriptor;
  }
  async status(opened, instanceId) {
    const entry = this.#active.get(instanceId);
    if (!entry) return { stale: true };
    try {
      return { stale: (await this.capture(opened, entry.descriptor.target)).signature !== entry.signature };
    } catch {
      return { stale: true };
    }
  }
  release(instanceId) {
    const entry = this.#active.get(instanceId);
    if (entry) this.source.release(entry.descriptor.url);
    this.#active.delete(instanceId);
  }
  clear() {
    for (const entry of this.#active.values()) this.source.release(entry.descriptor.url);
    this.#active.clear();
  }
  async close() {
    this.clear();
    await this.source.close();
  }
};

// src/server/project-candidate.ts
import { createHash as createHash8, randomUUID as randomUUID4 } from "node:crypto";
import { constants as constants2 } from "node:fs";
import { lstat as lstat4, mkdir as mkdir3, open as open4, readdir as readdir4, rename as rename2, rm as rm4 } from "node:fs/promises";
import { dirname as dirname5, join as join7 } from "node:path";
var CandidateError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var hash = (bytes) => `sha256:${createHash8("sha256").update(bytes).digest("hex")}`;
var fail4 = (code, message) => {
  throw new CandidateError(code, message);
};
var MAX_BYTES = 32 * 1024 * 1024;
var safePath2 = (path) => path.length <= 1024 && !path.includes("\\") && !path.includes("\0") && path.split("/").every((p) => p && p !== "." && p !== ".." && !["node_modules", "bundle", ".cache"].includes(p));
async function regular(path, max = MAX_BYTES) {
  const facts = await lstat4(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > max) throw new Error("\u6587\u4EF6\u7C7B\u578B\u6216\u5927\u5C0F\u65E0\u6548");
  const handle = await open4(path, constants2.O_RDONLY | constants2.O_NOFOLLOW | constants2.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error("\u6587\u4EF6\u7C7B\u578B\u6216\u5927\u5C0F\u65E0\u6548");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
async function directory(path) {
  const stat = await lstat4(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("\u76EE\u5F55\u5B8C\u6574\u6027\u65E0\u6548");
  return `${stat.dev}:${stat.ino}`;
}
async function readTree(root) {
  const tree = /* @__PURE__ */ new Map();
  let bytes = 0;
  async function walk(path, prefix, depth) {
    if (depth > 24) throw new Error("\u7A0B\u5E8F\u6811\u8D85\u8FC7 24 \u5C42");
    const identity2 = await directory(path);
    for (const name of (await readdir4(path)).sort()) {
      const relative4 = prefix ? `${prefix}/${name}` : name;
      if (!safePath2(relative4) || tree.size >= 4096) throw new Error("\u7A0B\u5E8F\u6811\u8DEF\u5F84\u6216\u6570\u91CF\u65E0\u6548");
      const full = join7(path, name);
      const stat = await lstat4(full);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        tree.set(relative4, null);
        await walk(full, relative4, depth + 1);
      } else {
        const content = await regular(full);
        bytes += content.length;
        if (bytes > MAX_BYTES) throw new Error("\u7A0B\u5E8F\u6811\u8D85\u8FC7 32 MiB");
        tree.set(relative4, content);
      }
    }
    if (await directory(path) !== identity2) throw new Error("\u8BFB\u53D6\u671F\u95F4\u76EE\u5F55\u88AB\u66FF\u6362");
  }
  await walk(root, "", 0);
  for (const required of ["program.json", "package.json", "pnpm-lock.yaml", "src/RenderProgram.tsx"]) {
    if (!Buffer.isBuffer(tree.get(required))) throw new Error(`\u7A0B\u5E8F\u6811\u7F3A\u5C11 ${required}`);
  }
  if (tree.get("src") !== null || tree.get("resources") !== null) throw new Error("\u7A0B\u5E8F\u6811\u7F3A\u5C11 src/ \u6216 resources/");
  for (const path of tree.keys()) {
    if (!["program.json", "package.json", "pnpm-lock.yaml", "src", "resources"].includes(path) && !path.startsWith("src/") && !path.startsWith("resources/")) throw new Error("\u7A0B\u5E8F\u6811\u5305\u542B\u672A\u5141\u8BB8\u7684\u9876\u5C42\u8DEF\u5F84");
  }
  return tree;
}
async function readOffline(project, state) {
  if (!state.offline) return void 0;
  if (!Array.isArray(state.offlineKeys) || state.offlineKeys.some((key) => !/^[0-9a-f]{128}$/.test(key)) || hash(JSON.stringify([...new Set(state.offlineKeys)].sort())) !== state.offlineIdentity) fail4("DEPENDENCY_INTEGRITY_FAILED", "\u79BB\u7EBF\u4F9D\u8D56\u7D22\u5F15\u65E0\u6548\u3002");
  const root = join7(project, state.offline);
  await directory(dirname5(root));
  const store = /* @__PURE__ */ new Map();
  const rawStore = /* @__PURE__ */ new Map();
  const observed = [];
  try {
    await directory(root);
  } catch (error) {
    if (error.code === "ENOENT") return { store, rawStore, intact: false, signature: hash("missing-directory") };
    throw error;
  }
  for (const filename of (await readdir4(root)).sort()) {
    if (!/^[0-9a-f]{128}\.tgz$/.test(filename)) fail4("DEPENDENCY_INTEGRITY_FAILED", "\u79BB\u7EBF\u4F9D\u8D56\u5E93\u5305\u542B\u975E\u6CD5\u8DEF\u5F84\u3002");
    const bytes = await regular(join7(root, filename));
    const key = filename.slice(0, -4);
    observed.push([key, hash(bytes)]);
    rawStore.set(key, bytes);
    try {
      verifyPackageBytes(key, bytes);
      store.set(key, bytes);
    } catch {
    }
  }
  return {
    store,
    rawStore,
    intact: offlineIdentity(store) === state.offlineIdentity && store.size === observed.length,
    signature: hash(JSON.stringify(observed))
  };
}
var offlineIdentity = (store) => hash(JSON.stringify([...store.keys()].sort()));
var offlineSignature = (store) => hash(JSON.stringify([...store].sort(([a], [b]) => a.localeCompare(b)).map(([key, bytes]) => [key, hash(bytes)])));
function identity(tree) {
  return hash(JSON.stringify([...tree].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => [path, bytes === null ? "directory" : hash(bytes)])));
}
async function writeBytes(path, bytes) {
  const handle = await open4(path, "wx", 384);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeTree(root, tree) {
  await mkdir3(root);
  for (const [path, bytes] of [...tree].sort(([a], [b]) => a.length - b.length)) {
    if (bytes === null) await mkdir3(join7(root, path));
    else await writeBytes(join7(root, path), bytes);
  }
  for (const [path, bytes] of [...tree].reverse()) if (bytes === null) await syncDirectory(join7(root, path));
  await syncDirectory(root);
}
async function syncDirectory(path) {
  const handle = await open4(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function createCandidateManager(project, assertWritable) {
  const internal = join7(project, ".narracut");
  const internalIdentity = await directory(internal);
  const pointer = join7(internal, "candidate.json");
  const assertCurrent = async () => {
    await assertWritable();
    if (await directory(internal) !== internalIdentity) fail4("PROJECT_IDENTITY_LOST", "\u9879\u76EE\u5185\u90E8\u76EE\u5F55\u8EAB\u4EFD\u53D8\u5316\uFF1B\u5DF2\u505C\u6B62\u5019\u9009\u5199\u5165\u3002");
  };
  async function currentRevision() {
    const value = JSON.parse((await regular(join7(internal, "current.json"), 4096)).toString());
    if (!/^[0-9a-f-]{36}$/i.test(value.revisionId)) throw new Error("\u5F53\u524D\u4FEE\u8BA2\u8EAB\u4EFD\u65E0\u6548");
    return value.revisionId;
  }
  async function pointerBytes() {
    try {
      return await regular(pointer, 4 * 1024 * 1024);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  const refValid = (ref) => ref && /^\.narracut\/candidate-[0-9a-f-]{36}\/(candidate|checkpoint)$/.test(ref.path) && /^sha256:[0-9a-f]{64}$/.test(ref.identity);
  async function inspect() {
    await assertCurrent();
    const sourceRevision = await currentRevision();
    let raw = null;
    let state = null;
    try {
      raw = await pointerBytes();
      if (raw === null) return { view: { status: "absent", sourceRevision, baseline: hash("absent"), candidate: null, checkpoint: null }, state: null, raw };
      const parsed = JSON.parse(raw.toString());
      if (parsed.version !== 1 || !/^[0-9a-f-]{36}$/i.test(parsed.sourceRevision) || !(parsed.candidate === null || refValid(parsed.candidate)) || !(parsed.checkpoint === null || refValid(parsed.checkpoint) && dirname5(parsed.checkpoint.path) === dirname5(parsed.candidate?.path ?? "") && parsed.checkpoint.path.endsWith("/checkpoint")) || parsed.candidate !== null && !parsed.candidate.path.endsWith("/candidate") || parsed.candidate === null && parsed.checkpoint !== null || parsed.offline !== void 0 && !/^\.narracut\/candidate-[0-9a-f-]{36}\/dependencies$/.test(parsed.offline)) throw new Error("\u5019\u9009\u6307\u9488\u5B8C\u6574\u6027\u65E0\u6548");
      state = parsed;
      const offline = await readOffline(project, state);
      if (!state.candidate) return { raw, state, offline, view: { status: "absent", ...offline && !offline.intact ? { error: { code: "DEPENDENCY_INTEGRITY_FAILED", message: "\u4FDD\u7559\u79BB\u7EBF\u5E93\u7F3A\u5305\u6216\u635F\u574F\uFF1B\u8BF7\u5148\u663E\u5F0F\u521B\u5EFA\u5019\u9009\uFF0C\u518D\u534F\u8C03\u4FEE\u590D\u3002" } } : {}, sourceRevision, baseline: hash(JSON.stringify([hash(raw), offline?.signature ?? null])), candidate: null, checkpoint: null, ...state.offline ? { offline: state.offline } : {} } };
      await directory(dirname5(join7(project, state.candidate.path)));
      const tree = await readTree(join7(project, state.candidate.path));
      const treeId = identity(tree);
      let checkpointId = null;
      if (state.checkpoint) {
        await directory(dirname5(join7(project, state.checkpoint.path)));
        checkpointId = identity(await readTree(join7(project, state.checkpoint.path)));
        if (checkpointId !== state.checkpoint.identity) throw new Error("\u6062\u590D\u68C0\u67E5\u70B9\u5B57\u8282\u53D1\u751F\u53D8\u5316");
      }
      const external = treeId !== state.candidate.identity;
      return { raw, state, tree, offline, view: {
        status: external ? "external-change" : offline && !offline.intact ? "integrity-failed" : "saved",
        sourceRevision: state.sourceRevision,
        baseline: hash(JSON.stringify([hash(raw), treeId, checkpointId, offline?.signature ?? null])),
        candidate: { ...state.candidate, identity: treeId },
        checkpoint: state.checkpoint,
        ...state.offline ? { offline: state.offline } : {},
        ...!external && offline && !offline.intact ? { error: { code: "DEPENDENCY_INTEGRITY_FAILED", message: "\u79BB\u7EBF\u4F9D\u8D56\u5E93\u7F3A\u5305\u6216\u635F\u574F\uFF1B\u8BF7\u663E\u5F0F\u534F\u8C03\u4FEE\u590D\uFF0C\u666E\u901A\u64CD\u4F5C\u4E0D\u4F1A\u8865\u5305\u3002" } } : {},
        ...external ? { error: { code: "EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED", message: "\u5019\u9009\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF0C\u5916\u90E8\u5B57\u8282\u5DF2\u4FDD\u7559\u3002\u9700\u8981\u91CD\u65B0\u68C0\u67E5\uFF1B\u672A\u63D0\u4EA4\u4FEE\u6539\u4E0D\u5F97\u8986\u76D6\u3002" } } : {}
      } };
    } catch (error) {
      return { raw, state, view: {
        status: "integrity-failed",
        sourceRevision,
        baseline: hash(raw ?? "invalid"),
        candidate: state?.candidate ?? null,
        checkpoint: state?.checkpoint ?? null,
        error: { code: "CANDIDATE_INTEGRITY_FAILED", message: `\u5019\u9009\u6216\u6062\u590D\u68C0\u67E5\u70B9\u5B8C\u6574\u6027\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u73B0\u573A\u3002\u8BF7\u5916\u90E8\u4FEE\u590D\u540E\u91CD\u65B0\u68C0\u67E5\uFF0C\u6216\u660E\u786E\u653E\u5F03\u3002${error.message}` }
      } };
    }
  }
  const operate = async (request) => {
    const before = await inspect();
    if (request.action === "read") return before.view;
    if (request.action === "create" && before.view.status !== "absent") fail4("CANDIDATE_ALREADY_EXISTS", "\u9879\u76EE\u5DF2\u7ECF\u5B58\u5728\u552F\u4E00\u5019\u9009\uFF1B\u8BF7\u7EE7\u7EED\u4F7F\u7528\u6216\u660E\u786E\u653E\u5F03\u3002");
    if (request.action !== "create" && request.baseline !== before.view.baseline) fail4("EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED", "\u5019\u9009\u57FA\u7EBF\u5DF2\u53D8\u5316\uFF1B\u672C\u6279\u672A\u4FDD\u5B58\uFF0C\u5916\u90E8\u5B57\u8282\u4E0E\u6062\u590D\u68C0\u67E5\u70B9\u5DF2\u4FDD\u7559\u3002");
    if (request.action === "discard") {
      if (!request.confirmed) fail4("CANDIDATE_DISCARD_CONFIRMATION_REQUIRED", "\u653E\u5F03\u4E0D\u53EF\u64A4\u9500\uFF0C\u9700\u8981\u660E\u786E\u786E\u8BA4\u3002");
      if (before.view.status === "absent") return before.view;
      await assertCurrent();
      if (!(await pointerBytes())?.equals(before.raw ?? Buffer.alloc(0))) fail4("EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED", "\u5019\u9009\u6307\u9488\u5DF2\u53D8\u5316\uFF0C\u672A\u653E\u5F03\u3002");
      if (before.state?.offline) {
        const tombstone = Buffer.from(JSON.stringify({ ...before.state, candidate: null, checkpoint: null }));
        const temporary = join7(internal, `discard-${randomUUID4()}.json`);
        try {
          await writeBytes(temporary, tombstone);
          await rename2(temporary, pointer);
        } finally {
          await rm4(temporary, { force: true });
        }
        await syncDirectory(internal).catch(() => void 0);
        for (const ref of [before.state.candidate, before.state.checkpoint]) if (ref) await rm4(join7(project, ref.path), { recursive: true, force: true }).catch(() => void 0);
        return { status: "absent", baseline: hash(JSON.stringify([hash(tombstone), before.offline?.signature ?? null])), sourceRevision: await currentRevision(), candidate: null, checkpoint: null, offline: before.state.offline };
      }
      await rm4(pointer);
      if (before.state?.candidate) await rm4(dirname5(join7(project, before.state.candidate.path)), { recursive: true, force: true }).catch(() => void 0);
      return { status: "absent", baseline: hash("absent"), sourceRevision: await currentRevision(), candidate: null, checkpoint: null };
    }
    if (request.action !== "create" && (before.view.status !== "saved" && !(request.action === "dependencies" && before.view.error?.code === "DEPENDENCY_INTEGRITY_FAILED") || !before.tree)) {
      fail4(before.view.error?.code ?? "CANDIDATE_MISSING", before.view.error?.message ?? "\u8BF7\u5148\u663E\u5F0F\u521B\u5EFA\u5019\u9009\u3002");
    }
    const sourceRevision = await currentRevision();
    const currentRoot = join7(internal, "revisions", sourceRevision, "render-program");
    let next;
    let offline = request.action === "create" ? before.offline?.rawStore : before.offline?.store;
    if (request.action === "create") {
      await directory(join7(internal, "revisions"));
      await directory(dirname5(currentRoot));
      next = await readTree(currentRoot);
    } else if (request.action === "dependencies") {
      const retainedLocks = [];
      await directory(join7(internal, "revisions"));
      for (const revision of await readdir4(join7(internal, "revisions"))) {
        if (!/^[0-9a-f-]{36}$/i.test(revision)) fail4("DEPENDENCY_LOCK_INVALID", "\u4FDD\u7559\u4FEE\u8BA2\u76EE\u5F55\u8EAB\u4EFD\u65E0\u6548\u3002");
        await directory(join7(internal, "revisions", revision));
        const retained = await readTree(join7(internal, "revisions", revision, "render-program"));
        retainedLocks.push(retained.get("pnpm-lock.yaml"));
      }
      if (before.state?.checkpoint) retainedLocks.push((await readTree(join7(project, before.state.checkpoint.path))).get("pnpm-lock.yaml"));
      const update = await coordinateDependencies(before.tree.get("package.json"), before.tree.get("pnpm-lock.yaml"), offline ?? /* @__PURE__ */ new Map(), request, retainedLocks, before.state?.offlineKeys);
      if (before.state?.offlineKeys?.some((key) => !update.store.has(key))) fail4("DEPENDENCY_INTEGRITY_FAILED", "\u4ECD\u6709\u4FDD\u7559\u79BB\u7EBF\u5305\u65E0\u6CD5\u4FEE\u590D\uFF1B\u8BF7\u63D0\u4F9B\u5176\u7CBE\u786E\u7248\u672C\u548C\u6458\u8981\u3002");
      next = new Map(before.tree);
      next.set("package.json", update.manifest);
      next.set("pnpm-lock.yaml", update.lock);
      offline = update.store;
    } else {
      next = new Map(before.tree);
      if (!Array.isArray(request.changes) || request.changes.length === 0 || request.changes.length > 256) fail4("CANDIDATE_BATCH_INVALID", "\u4FEE\u6539\u6279\u6B21\u5FC5\u987B\u5305\u542B 1\u2013256 \u9879\u3002");
      const seen = /* @__PURE__ */ new Set();
      for (const change of request.changes) {
        if (!change || typeof change.path !== "string" || !safePath2(change.path) || !(change.path === "program.json" || change.path.startsWith("src/") || change.path.startsWith("resources/")) || !(change.content === null || typeof change.content === "string") || seen.has(change.path)) fail4("CANDIDATE_BATCH_INVALID", "\u6279\u6B21\u8DEF\u5F84\u3001\u5185\u5BB9\u6216\u91CD\u590D\u9879\u65E0\u6548\uFF1B\u4F9D\u8D56\u6587\u4EF6\u53EA\u80FD\u7531\u4F9D\u8D56\u534F\u8C03\u4FEE\u6539\u3002");
        seen.add(change.path);
        if (next.get(change.path) === null) fail4("CANDIDATE_BATCH_INVALID", "\u4E0D\u80FD\u5C06\u76EE\u5F55\u4F5C\u4E3A\u6587\u4EF6\u4FEE\u6539\u3002");
        if (change.content === null) next.delete(change.path);
        else {
          const bytes = Buffer.from(change.content, "utf8");
          if (bytes.length > MAX_BYTES || bytes.toString() !== change.content) fail4("CANDIDATE_BATCH_INVALID", "\u5185\u5BB9\u8D85\u9650\u6216\u4E0D\u662F\u4E25\u683C UTF-8\u3002");
          const parts = change.path.split("/");
          for (let i = 1; i < parts.length; i++) {
            const parent = parts.slice(0, i).join("/");
            if (Buffer.isBuffer(next.get(parent))) fail4("CANDIDATE_BATCH_INVALID", "\u6587\u4EF6\u4E0E\u76EE\u5F55\u8DEF\u5F84\u51B2\u7A81\u3002");
            next.set(parent, null);
          }
          next.set(change.path, bytes);
        }
      }
    }
    const generation = `.narracut/candidate-${randomUUID4()}`;
    const root = join7(project, generation);
    let committed = false;
    try {
      await assertCurrent();
      await mkdir3(root);
      await writeTree(join7(root, "candidate"), next);
      if (offline) {
        await mkdir3(join7(root, "dependencies"));
        for (const [key, bytes2] of offline) await writeBytes(join7(root, "dependencies", `${key}.tgz`), bytes2);
        await syncDirectory(join7(root, "dependencies"));
      }
      const treeId = identity(await readTree(join7(root, "candidate")));
      if (before.tree) await writeTree(join7(root, "checkpoint"), before.tree);
      const state = {
        version: 1,
        sourceRevision: before.state?.sourceRevision ?? sourceRevision,
        candidate: { path: `${generation}/candidate`, identity: treeId },
        checkpoint: before.tree ? { path: `${generation}/checkpoint`, identity: identity(before.tree) } : null,
        ...offline ? { offline: `${generation}/dependencies`, offlineIdentity: request.action === "create" && before.offline && !before.offline.intact ? before.state.offlineIdentity : offlineIdentity(offline), offlineKeys: request.action === "create" && before.offline && !before.offline.intact ? before.state.offlineKeys : [...offline.keys()].sort() } : {}
      };
      const bytes = Buffer.from(JSON.stringify(state));
      await writeBytes(join7(root, "state.json"), bytes);
      await syncDirectory(root);
      await assertCurrent();
      const latest = await inspect();
      if (latest.view.baseline !== before.view.baseline || latest.view.status !== before.view.status || await currentRevision() !== sourceRevision || request.action === "create" && identity(await readTree(currentRoot)) !== treeId) fail4("EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED", "\u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1B\u672C\u6279\u672A\u4FDD\u5B58\uFF0C\u4E0A\u4E00\u4EFD\u5019\u9009\u5DF2\u4FDD\u7559\u3002");
      await rename2(join7(root, "state.json"), pointer);
      committed = true;
      await syncDirectory(internal).catch(() => void 0);
      if (before.state?.candidate || before.state?.offline) await rm4(dirname5(join7(project, before.state.candidate?.path ?? before.state.offline)), { recursive: true, force: true }).catch(() => void 0);
      return {
        status: request.action === "create" && before.offline && !before.offline.intact ? "integrity-failed" : "saved",
        ...request.action === "create" && before.offline && !before.offline.intact ? { error: { code: "DEPENDENCY_INTEGRITY_FAILED", message: "\u79BB\u7EBF\u4F9D\u8D56\u5E93\u7F3A\u5305\u6216\u635F\u574F\uFF1B\u8BF7\u663E\u5F0F\u534F\u8C03\u4FEE\u590D\uFF0C\u666E\u901A\u64CD\u4F5C\u4E0D\u4F1A\u8865\u5305\u3002" } } : {},
        sourceRevision: state.sourceRevision,
        baseline: hash(JSON.stringify([hash(bytes), treeId, state.checkpoint?.identity ?? null, offline ? offlineSignature(offline) : null])),
        candidate: state.candidate,
        checkpoint: state.checkpoint,
        ...state.offline ? { offline: state.offline } : {}
      };
    } catch (error) {
      if (error instanceof CandidateError) throw error;
      return fail4("CANDIDATE_SAVE_FAILED", `\u672C\u6279\u672A\u4FDD\u5B58\uFF0C\u4E0A\u4E00\u4EFD\u5019\u9009\u4E0E\u6062\u590D\u68C0\u67E5\u70B9\u5DF2\u4FDD\u7559\u3002${error.message}`);
    } finally {
      if (!committed) await rm4(root, { recursive: true, force: true }).catch(() => void 0);
    }
  };
  return Object.assign(operate, {
    async previewSource(target) {
      const snapshot = await inspect();
      const revision = await currentRevision();
      const tree = target === "current" ? await readTree(join7(internal, "revisions", revision, "render-program")) : snapshot.tree;
      if (!tree || target === "candidate" && snapshot.view.status !== "saved") fail4("CANDIDATE_BASELINE_CONFLICT", "\u6CA1\u6709\u5B8C\u6574\u53EF\u64AD\u653E\u7A0B\u5E8F\u3002");
      return { revision, identity: identity(tree), manifest: Buffer.from(tree.get("program.json") ?? ""), baseline: snapshot.view.baseline };
    },
    async build(request) {
      const before = await inspect();
      if (request.target !== "current" && (before.view.status !== "saved" || !before.tree) || before.view.baseline !== request.baseline) {
        throw new CandidateError("CANDIDATE_BASELINE_CONFLICT", "\u5019\u9009\u4E0D\u5B8C\u6574\u6216\u5DF2\u53D8\u5316\uFF1B\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540E\u6784\u5EFA\u3002");
      }
      const revision = await currentRevision();
      const tree = request.target === "current" ? await readTree(join7(internal, "revisions", revision, "render-program")) : before.tree;
      if (request.sourceIdentity && request.sourceIdentity !== identity(tree)) fail4("CANDIDATE_BASELINE_CONFLICT", "\u7A0B\u5E8F\u5728\u6784\u5EFA\u524D\u5DF2\u53D8\u5316\u3002");
      const program = new Map([...tree].filter((entry) => entry[1] !== null));
      const bundle = await buildProgramBundle({ ...request, program, offline: before.offline?.store ?? /* @__PURE__ */ new Map() });
      const after = await inspect();
      if (request.target !== "current" && after.view.status !== "saved" || after.view.baseline !== before.view.baseline || request.target === "current" && (await currentRevision() !== revision || identity(await readTree(join7(internal, "revisions", revision, "render-program"))) !== identity(tree))) {
        throw new CandidateError("CANDIDATE_BASELINE_CONFLICT", "\u6784\u5EFA\u671F\u95F4\u5019\u9009\u6216\u79BB\u7EBF\u5E93\u5DF2\u53D8\u5316\uFF1B\u7ED3\u679C\u5DF2\u4E22\u5F03\u3002");
      }
      return bundle;
    }
  });
}

// plugins/narracut/src/server.ts
import { randomUUID as randomUUID7 } from "node:crypto";
import { readFile as readFile6 } from "node:fs/promises";
import { basename as basename3, isAbsolute as isAbsolute4 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// plugins/narracut/src/codex-app-server-host.ts
import { spawn as spawn2 } from "node:child_process";
import { createInterface } from "node:readline";

// plugins/narracut/src/codex-host.ts
import { randomUUID as randomUUID5 } from "node:crypto";
var CodexThreadUnavailableError = class extends Error {
  threadId;
  constructor(threadId) {
    super(`Codex \u521B\u4F5C\u7EBF\u7A0B ${threadId} \u4E0D\u53EF\u7528\u3002`);
    this.name = "CodexThreadUnavailableError";
    this.threadId = threadId;
  }
};
var validationOutputSchema = {
  type: "object",
  required: ["verificationToken", "projectId", "sceneCount", "summary"],
  properties: {
    verificationToken: { type: "string" },
    projectId: { type: "string" },
    sceneCount: { type: "integer", minimum: 0 },
    summary: { type: "string", maxLength: 240 }
  },
  additionalProperties: false
};
function checkpointFor(task) {
  if (task.state.status === "succeeded") return null;
  return {
    taskId: task.state.taskId,
    status: task.state.status,
    reason: task.state.reason,
    threadPointer: task.state.connection.threadId
  };
}
function availableActions(status) {
  if (status === "running") return ["stop"];
  if (status === "stopped") return ["continue"];
  return [];
}
function publicState(task) {
  return {
    ...task.state,
    connection: { ...task.state.connection },
    result: task.state.result === null ? null : { ...task.state.result, verification: { ...task.state.result.verification } },
    diagnostic: task.state.diagnostic === null ? null : { ...task.state.diagnostic },
    checkpoint: checkpointFor(task),
    availableActions: [...task.state.availableActions]
  };
}
function boundedMessage(message, fallback) {
  if (typeof message !== "string" || message.trim() === "") return fallback;
  return message.trim().slice(0, 240);
}
function validationPrompt(task, verificationToken) {
  return [
    "\u8FD9\u662F Narracut \u7684\u4E00\u6B21\u56FA\u5B9A Codex \u521B\u4F5C\u7EBF\u7A0B\u5BBF\u4E3B\u9A8C\u8BC1\uFF0C\u4E0D\u662F\u521B\u4F5C\u4EFB\u52A1\u3002",
    "\u53EA\u8BFB\u68C0\u67E5\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\u4E2D\u7684 narracut.json \u4E0E project.json\uFF1B\u4E0D\u8981\u521B\u5EFA\u3001\u4FEE\u6539\u6216\u5220\u9664\u4EFB\u4F55\u6587\u4EF6\uFF0C\u4E5F\u4E0D\u8981\u6267\u884C\u7F51\u7EDC\u64CD\u4F5C\u3002",
    `\u786E\u8BA4 Project ID \u662F ${task.request.projectId}\uFF0CScene \u6570\u91CF\u662F ${task.request.sceneCount}\u3002`,
    `\u6700\u7EC8\u53EA\u8FD4\u56DE\u7B26\u5408\u7ED9\u5B9A JSON Schema \u7684\u5BF9\u8C61\uFF0C\u5176\u4E2D verificationToken \u5FC5\u987B\u539F\u6837\u8FD4\u56DE ${verificationToken}\u3002`,
    "summary \u7528\u4E00\u53E5\u4E2D\u6587\u8BF4\u660E\u5DF2\u5728\u53EA\u8BFB\u8FB9\u754C\u5185\u6838\u5BF9 Project VNext \u8EAB\u4EFD\u3002"
  ].join("\n");
}
var AgentHostValidationService = class {
  #host;
  #idFactory;
  #tasks = /* @__PURE__ */ new Map();
  #driverOwners = /* @__PURE__ */ new Map();
  #unsubscribe;
  constructor(host, options = {}) {
    this.#host = host;
    this.#idFactory = options.idFactory ?? randomUUID5;
    this.#unsubscribe = host.subscribe((event) => this.#handleHostEvent(event));
  }
  async start(request) {
    const taskId = this.#idFactory();
    const task = {
      request,
      activeDriver: null,
      state: {
        taskId,
        status: "stopped",
        reason: "CODEX_UNAVAILABLE",
        connection: { status: "unavailable", threadId: null, replaced: false },
        result: null,
        diagnostic: null,
        checkpoint: null,
        availableActions: ["continue"],
        projectModified: false
      }
    };
    this.#tasks.set(taskId, task);
    await this.#bindAndRun(task, null);
    return publicState(task);
  }
  get(taskId) {
    return publicState(this.#requireTask(taskId));
  }
  async stop(taskId) {
    const task = this.#requireTask(taskId);
    const driver = task.activeDriver;
    task.activeDriver = null;
    this.#setStopped(task, "USER_STOPPED");
    if (driver !== null) {
      try {
        await this.#host.interruptTurn({ threadId: driver.threadId, turnId: driver.turnId });
      } catch (error) {
        task.state.diagnostic = {
          code: "HOST_INTERRUPT_FAILED",
          message: boundedMessage(error instanceof Error ? error.message : error, "Codex Turn \u672A\u80FD\u786E\u8BA4\u4E2D\u65AD\u3002")
        };
      }
    }
    return publicState(task);
  }
  async continue(taskId) {
    const task = this.#requireTask(taskId);
    if (task.state.status !== "stopped") {
      throw new Error("\u53EA\u6709\u5DF2\u505C\u6B62\u7684\u5BBF\u4E3B\u9A8C\u8BC1\u4EFB\u52A1\u53EF\u4EE5\u7EE7\u7EED\u3002");
    }
    const threadPointer = task.state.connection.threadId;
    await this.#bindAndRun(task, threadPointer);
    return publicState(task);
  }
  async dispose() {
    this.#unsubscribe();
    await this.#host.dispose();
  }
  #requireTask(taskId) {
    const task = this.#tasks.get(taskId);
    if (task === void 0) throw new Error(`\u672A\u77E5\u5BBF\u4E3B\u9A8C\u8BC1\u4EFB\u52A1\uFF1A${taskId}`);
    return task;
  }
  async #bindAndRun(task, threadPointer) {
    task.state.diagnostic = null;
    let threadId = threadPointer;
    let replaced = false;
    try {
      if (threadPointer === null) {
        ({ threadId } = await this.#host.createThread({
          projectDirectory: task.request.projectDirectory
        }));
      } else {
        try {
          ({ threadId } = await this.#host.resumeThread({
            threadId: threadPointer,
            projectDirectory: task.request.projectDirectory
          }));
        } catch (error) {
          if (!(error instanceof CodexThreadUnavailableError)) throw error;
          ({ threadId } = await this.#host.createThread({
            projectDirectory: task.request.projectDirectory
          }));
          replaced = true;
        }
      }
      if (threadId === null) throw new Error("Codex Thread \u7ED1\u5B9A\u672A\u8FD4\u56DE\u6709\u6548\u6307\u9488\u3002");
      const driverId = this.#idFactory();
      const verificationToken = this.#idFactory();
      const { turnId } = await this.#host.startTurn({
        threadId,
        projectDirectory: task.request.projectDirectory,
        verificationToken,
        prompt: validationPrompt(task, verificationToken),
        outputSchema: validationOutputSchema
      });
      const driver = { id: driverId, threadId, turnId, verificationToken };
      task.activeDriver = driver;
      this.#driverOwners.set(`${threadId}:${turnId}`, task.state.taskId);
      task.state.status = "running";
      task.state.reason = null;
      task.state.connection = { status: "connected", threadId, replaced };
      task.state.result = null;
      task.state.availableActions = availableActions("running");
      task.state.checkpoint = checkpointFor(task);
    } catch (error) {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_UNAVAILABLE");
      task.state.connection = {
        status: "unavailable",
        threadId,
        replaced
      };
      task.state.diagnostic = {
        code: "CODEX_HOST_UNAVAILABLE",
        message: boundedMessage(error instanceof Error ? error.message : error, "Codex \u5BBF\u4E3B\u4E0D\u53EF\u7528\u3002")
      };
    }
  }
  #setStopped(task, reason) {
    task.state.status = "stopped";
    task.state.reason = reason;
    task.state.result = null;
    task.state.availableActions = availableActions("stopped");
    task.state.checkpoint = checkpointFor(task);
  }
  #handleHostEvent(event) {
    if (event.type === "host-unavailable") {
      for (const task2 of this.#tasks.values()) {
        if (task2.state.status === "succeeded") continue;
        if (task2.activeDriver !== null) {
          task2.activeDriver = null;
          this.#setStopped(task2, "CODEX_UNAVAILABLE");
        }
        task2.state.connection.status = "unavailable";
        task2.state.diagnostic = {
          code: "CODEX_HOST_UNAVAILABLE",
          message: boundedMessage(event.error, "Codex \u5BBF\u4E3B\u8FDE\u63A5\u5DF2\u4E2D\u65AD\u3002")
        };
      }
      return;
    }
    const turnKey = event.turnId === void 0 ? null : `${event.threadId}:${event.turnId}`;
    let task = turnKey === null ? void 0 : this.#tasks.get(this.#driverOwners.get(turnKey) ?? "");
    task ??= [...this.#tasks.values()].find(
      (candidate) => candidate.state.connection.threadId === event.threadId
    );
    if (task === void 0) return;
    const driver = task.activeDriver;
    if (event.type === "thread-unavailable" && driver === null && task.state.status === "stopped" && task.state.connection.threadId === event.threadId) {
      task.state.connection.status = "unavailable";
      task.state.diagnostic = {
        code: "CODEX_THREAD_UNAVAILABLE",
        message: "Codex \u521B\u4F5C\u7EBF\u7A0B\u4E0D\u53EF\u7528\uFF1B\u7EE7\u7EED\u65F6\u5C06\u81EA\u52A8\u521B\u5EFA\u66FF\u4EE3\u7EBF\u7A0B\u3002"
      };
      return;
    }
    const isCurrent = driver !== null && driver.threadId === event.threadId && (event.turnId === void 0 || driver.turnId === event.turnId);
    if (!isCurrent) {
      task.state.diagnostic = {
        code: "LATE_DRIVER_CALLBACK_REJECTED",
        message: "\u5DF2\u62D2\u7EDD\u5931\u53BB\u5199\u6743\u7684\u65E7 Codex \u521B\u4F5C\u7EBF\u7A0B\u56DE\u8C03\uFF1B\u5F53\u524D\u4EFB\u52A1\u72B6\u6001\u672A\u6539\u53D8\u3002"
      };
      return;
    }
    if (event.type === "thread-unavailable") {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_THREAD_UNAVAILABLE");
      task.state.connection.status = "unavailable";
      task.state.diagnostic = {
        code: "CODEX_THREAD_UNAVAILABLE",
        message: "Codex \u521B\u4F5C\u7EBF\u7A0B\u4E0D\u53EF\u7528\uFF1B\u7EE7\u7EED\u65F6\u5C06\u81EA\u52A8\u521B\u5EFA\u66FF\u4EE3\u7EBF\u7A0B\u3002"
      };
      return;
    }
    if (event.status !== "completed" || event.output === void 0) {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_INTERRUPTED");
      task.state.diagnostic = {
        code: "CODEX_TURN_INTERRUPTED",
        message: boundedMessage(event.error, "Codex \u9A8C\u8BC1 Turn \u672A\u5B8C\u6210\u3002")
      };
      return;
    }
    let parsed;
    try {
      const value = JSON.parse(event.output);
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
      parsed = value;
    } catch {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_INTERRUPTED");
      task.state.diagnostic = {
        code: "HOST_VALIDATION_RESULT_INVALID",
        message: "Codex \u8FD4\u56DE\u4E86\u65E0\u6CD5\u9A8C\u8BC1\u7684\u7ED3\u6784\u5316\u7ED3\u679C\u3002"
      };
      return;
    }
    const summary = parsed.summary;
    const normalizedSummary = typeof summary === "string" ? summary.trim() : "";
    const valid2 = parsed.verificationToken === driver.verificationToken && parsed.projectId === task.request.projectId && parsed.sceneCount === task.request.sceneCount && typeof summary === "string" && normalizedSummary !== "" && summary.length <= 240;
    if (!valid2) {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_INTERRUPTED");
      task.state.diagnostic = {
        code: "HOST_VALIDATION_IDENTITY_MISMATCH",
        message: "Codex \u7ED3\u679C\u672A\u901A\u8FC7\u4EFB\u52A1\u3001\u9A71\u52A8\u6216\u9879\u76EE\u8EAB\u4EFD\u6821\u9A8C\u3002"
      };
      return;
    }
    task.activeDriver = null;
    task.state.status = "succeeded";
    task.state.reason = null;
    task.state.result = {
      projectId: task.request.projectId,
      sceneCount: task.request.sceneCount,
      summary: normalizedSummary,
      verification: { taskId: task.state.taskId, driverId: driver.id }
    };
    task.state.availableActions = availableActions("succeeded");
    task.state.checkpoint = null;
  }
};

// plugins/narracut/src/codex-app-server-host.ts
function objectValue(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function rpcError(method, error) {
  const message = error?.message?.trim() || "\u672A\u77E5 App Server \u9519\u8BEF";
  return new Error(`${method} \u5931\u8D25\uFF1A${message}`);
}
var CodexAppServerHost = class {
  #command;
  #commandArgs;
  #requestTimeoutMs;
  #listeners = /* @__PURE__ */ new Set();
  #pending = /* @__PURE__ */ new Map();
  #agentMessages = /* @__PURE__ */ new Map();
  #activeTurns = /* @__PURE__ */ new Map();
  #child = null;
  #lineReader = null;
  #ready = null;
  #requestId = 0;
  #stderrTail = "";
  #disposed = false;
  constructor(options = {}) {
    this.#command = options.command ?? (process.env.NARRACUT_CODEX_COMMAND?.trim() || "codex");
    this.#commandArgs = options.commandArgs ?? ["app-server", "--stdio"];
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 15e3;
  }
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  async createThread(input) {
    await this.#ensureReady();
    const result = await this.#request("thread/start", {
      cwd: input.projectDirectory,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "narracut-host-validation",
      developerInstructions: [
        "\u4F60\u6B63\u5728\u6267\u884C Narracut \u7684\u56FA\u5B9A\u5BBF\u4E3B\u8FB9\u754C\u9A8C\u8BC1\u3002",
        "\u53EA\u5141\u8BB8\u8BFB\u53D6\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\uFF1B\u4E0D\u5F97\u521B\u5EFA\u3001\u4FEE\u6539\u6216\u5220\u9664\u6587\u4EF6\uFF0C\u4E0D\u5F97\u8BBF\u95EE\u7F51\u7EDC\u3002",
        "\u6700\u7EC8\u54CD\u5E94\u5FC5\u987B\u4E25\u683C\u7B26\u5408 turn/start \u63D0\u4F9B\u7684 outputSchema\u3002"
      ].join("\n")
    });
    const threadId = result.thread?.id;
    if (typeof threadId !== "string" || threadId === "") {
      throw new Error("thread/start \u672A\u8FD4\u56DE Codex Thread ID\u3002");
    }
    return { threadId };
  }
  async resumeThread(input) {
    await this.#ensureReady();
    let result;
    try {
      result = await this.#request("thread/resume", {
        threadId: input.threadId,
        cwd: input.projectDirectory,
        approvalPolicy: "never",
        sandbox: "read-only",
        excludeTurns: true
      });
    } catch {
      throw new CodexThreadUnavailableError(input.threadId);
    }
    const threadId = result.thread?.id;
    if (threadId !== input.threadId) throw new CodexThreadUnavailableError(input.threadId);
    return { threadId: input.threadId };
  }
  async startTurn(input) {
    await this.#ensureReady();
    const result = await this.#request("turn/start", {
      threadId: input.threadId,
      input: [{ type: "text", text: input.prompt, text_elements: [] }],
      cwd: input.projectDirectory,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      outputSchema: input.outputSchema
    });
    const turnId = result.turn?.id;
    if (typeof turnId !== "string" || turnId === "") {
      throw new Error("turn/start \u672A\u8FD4\u56DE Codex Turn ID\u3002");
    }
    this.#activeTurns.set(input.threadId, turnId);
    return { turnId };
  }
  async interruptTurn(input) {
    await this.#ensureReady();
    await this.#request("turn/interrupt", input);
  }
  async dispose() {
    this.#disposed = true;
    const child = this.#child;
    const error = new Error("Codex App Server \u5DF2\u5173\u95ED\u3002");
    if (child !== null) this.#shutdownChild(child, error, false);
    else this.#clearTransientState(error);
  }
  async #ensureReady() {
    if (this.#disposed) throw new Error("Codex App Server \u9002\u914D\u5668\u5DF2\u5173\u95ED\u3002");
    if (this.#ready !== null) return this.#ready;
    this.#ready = this.#start();
    try {
      await this.#ready;
    } catch (error) {
      this.#ready = null;
      throw error;
    }
  }
  async #start() {
    const child = spawn2(this.#command, this.#commandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });
    this.#child = child;
    this.#stderrTail = "";
    this.#lineReader = createInterface({ input: child.stdout });
    this.#lineReader.on("line", (line) => this.#handleLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.#stderrTail = `${this.#stderrTail}${chunk}`.slice(-2e3);
    });
    child.once("error", (error) => this.#handleExit(child, error));
    child.once("exit", (code, signal) => {
      if (this.#child !== child) return;
      const detail = this.#stderrTail.trim();
      this.#handleExit(child, new Error(
        detail || `Codex App Server \u5DF2\u9000\u51FA\uFF08code=${String(code)}, signal=${String(signal)}\uFF09\u3002`
      ));
    });
    try {
      await this.#request("initialize", {
        clientInfo: { name: "narracut", title: "Narracut", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false }
      });
      this.#notify("initialized");
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.#shutdownChild(child, reason, false);
      throw reason;
    }
  }
  #request(method, params) {
    const child = this.#child;
    if (child === null || child.stdin.destroyed) {
      return Promise.reject(new Error("Codex App Server \u672A\u8FDE\u63A5\u3002"));
    }
    const id = ++this.#requestId;
    return new Promise((resolve4, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.delete(id)) return;
        const error = new Error(`${method} \u8D85\u8FC7 ${this.#requestTimeoutMs}ms \u672A\u54CD\u5E94\u3002`);
        reject(error);
        this.#handleExit(child, error);
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { method, resolve: resolve4, reject, timer });
      child.stdin.write(`${JSON.stringify({ method, id, params })}
`, (error) => {
        if (error === null || error === void 0) return;
        const pending = this.#pending.get(id);
        if (pending === void 0) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        reject(error);
        this.#handleExit(child, error);
      });
    });
  }
  #notify(method, params = {}) {
    const child = this.#child;
    if (child === null || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify({ method, params })}
`);
  }
  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      const child = this.#child;
      if (child !== null) this.#handleExit(child, new Error("Codex App Server \u8FD4\u56DE\u4E86\u65E0\u6548 JSON\u3002"));
      return;
    }
    if (message.id !== void 0 && message.method === void 0) {
      const pending = this.#pending.get(message.id);
      if (pending === void 0) return;
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      if (message.error !== void 0) pending.reject(rpcError(pending.method, message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== void 0 && message.method !== void 0) {
      this.#child?.stdin.write(`${JSON.stringify({
        id: message.id,
        error: { code: -32601, message: `Narracut \u4E0D\u652F\u6301\u5BBF\u4E3B\u8BF7\u6C42 ${message.method}\u3002` }
      })}
`);
      return;
    }
    const params = objectValue(message.params);
    if (message.method === "item/completed" && params !== null) {
      const item = objectValue(params.item);
      if (typeof params.threadId === "string" && typeof params.turnId === "string" && item?.type === "agentMessage" && typeof item.text === "string") {
        this.#agentMessages.set(`${params.threadId}:${params.turnId}`, item.text);
      }
      return;
    }
    if (message.method === "turn/completed" && params !== null) {
      const threadId = params.threadId;
      const turn = objectValue(params.turn);
      const turnId = turn?.id;
      const status = turn?.status;
      if (turn === null || typeof threadId !== "string" || typeof turnId !== "string" || status !== "completed" && status !== "interrupted" && status !== "failed") return;
      const items = Array.isArray(turn.items) ? turn.items : [];
      const finalMessage = items.map(objectValue).filter((item) => item?.type === "agentMessage" && typeof item.text === "string").at(-1)?.text;
      const messageKey = `${threadId}:${turnId}`;
      const output = typeof finalMessage === "string" ? finalMessage : this.#agentMessages.get(messageKey);
      this.#agentMessages.delete(messageKey);
      this.#activeTurns.delete(threadId);
      this.#emit({
        type: "turn-completed",
        threadId,
        turnId,
        status,
        ...output === void 0 ? {} : { output },
        ...turn.error === null || turn.error === void 0 ? {} : { error: JSON.stringify(turn.error).slice(0, 240) }
      });
      return;
    }
    if ((message.method === "thread/closed" || message.method === "thread/deleted") && params !== null) {
      const threadId = params.threadId;
      if (typeof threadId !== "string") return;
      const turnId = this.#activeTurns.get(threadId);
      this.#activeTurns.delete(threadId);
      if (turnId !== void 0) this.#agentMessages.delete(`${threadId}:${turnId}`);
      this.#emit({
        type: "thread-unavailable",
        threadId,
        turnId
      });
    }
  }
  #clearTransientState(error) {
    this.#lineReader?.close();
    this.#lineReader = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#agentMessages.clear();
    this.#activeTurns.clear();
  }
  #shutdownChild(child, error, emitUnavailable) {
    if (this.#child !== child) return;
    this.#child = null;
    this.#ready = null;
    this.#clearTransientState(error);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (emitUnavailable && !this.#disposed) {
      this.#emit({ type: "host-unavailable", error: error.message });
    }
  }
  #handleExit(child, error) {
    this.#shutdownChild(child, error, true);
  }
  #emit(event) {
    for (const listener of this.#listeners) listener(event);
  }
};

// src/server/project-lifecycle.ts
import { createHash as createHash9, randomUUID as randomUUID6 } from "node:crypto";
import { constants as fsConstants2 } from "node:fs";
import {
  access,
  link,
  lstat as lstat5,
  mkdir as mkdir4,
  open as openFile,
  readFile as readFile5,
  readdir as readdir5,
  realpath as realpath4,
  rename as rename3,
  rmdir,
  rm as rm5,
  unlink,
  writeFile as writeFile3
} from "node:fs/promises";
import { basename, dirname as dirname6, isAbsolute as isAbsolute3, join as join8, relative as relative3, resolve as resolve3, sep as sep2 } from "node:path";
var STARTER_REACT_VERSION = "19.2.8";
var STARTER_REMOTION_VERSION = RUNTIME_REMOTION_VERSION;
var ProjectLifecycleError = class extends Error {
  constructor(code, path, message, options = {}) {
    super(message, options);
    this.code = code;
    this.path = path;
    this.name = "ProjectLifecycleError";
  }
  code;
  path;
};
var ProjectTtsConfirmationError = class extends Error {
  constructor(affectedSpeechCount) {
    super(`\u4FDD\u5B58\u5F53\u524D TTS \u914D\u7F6E\u4F1A\u79FB\u9664 ${affectedSpeechCount} \u6761\u4E0D\u5339\u914D\u7684 Speech \u8BB0\u5F55\uFF0C\u9700\u8981\u91CD\u65B0\u786E\u8BA4\u3002`);
    this.affectedSpeechCount = affectedSpeechCount;
    this.name = "ProjectTtsConfirmationError";
  }
  affectedSpeechCount;
  code = "TTS_CONFIRMATION_REQUIRED";
};
var OPERATION_MARKER = ".narracut-operation.json";
var activeLeasePaths = /* @__PURE__ */ new Set();
function isCreateOperationMarker(value, projectDirectory, operationToken) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const marker = value;
  return Object.keys(marker).length === 5 && marker.kind === "narracut-operation" && marker.version === 1 && marker.operation === "create" && marker.targetDirectory === projectDirectory && typeof marker.operationToken === "string" && marker.operationToken.length > 0 && (operationToken === void 0 || marker.operationToken === operationToken);
}
async function pathExists(path) {
  try {
    await lstat5(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
async function removeConfirmedCreateResidue(temporaryDirectory, projectDirectory, confirmed) {
  const facts = await lstat5(temporaryDirectory);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `\u4E34\u65F6\u8DEF\u5F84\u4E0D\u662F\u53EF\u786E\u8BA4\u5F52\u5C5E\u7684\u666E\u901A\u76EE\u5F55\uFF1A${temporaryDirectory}\u3002Narracut \u62D2\u7EDD\u5220\u9664\u3002`
    );
  }
  const markerPath = join8(temporaryDirectory, OPERATION_MARKER);
  let marker;
  try {
    const markerFacts = await lstat5(markerPath);
    if (!markerFacts.isFile() || markerFacts.isSymbolicLink() || markerFacts.nlink !== 1 || markerFacts.size > 4096) {
      throw new Error("invalid marker");
    }
    marker = JSON.parse(await readFile5(markerPath, "utf8"));
  } catch {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `\u4E34\u65F6\u76EE\u5F55\u7F3A\u5C11\u53EF\u9A8C\u8BC1\u7684\u521B\u5EFA\u6807\u8BB0\uFF1A${temporaryDirectory}\u3002Narracut \u62D2\u7EDD\u5220\u9664\u3002`
    );
  }
  if (!isCreateOperationMarker(marker, projectDirectory)) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `\u4E34\u65F6\u76EE\u5F55\u6807\u8BB0\u4E0E\u672C\u6B21\u521B\u5EFA\u76EE\u6807\u4E0D\u5339\u914D\uFF1A${temporaryDirectory}\u3002Narracut \u62D2\u7EDD\u5220\u9664\u3002`
    );
  }
  if (!confirmed) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE",
      temporaryDirectory,
      `\u53D1\u73B0\u4E0E\u672C\u6B21\u76EE\u6807\u5339\u914D\u7684\u521B\u5EFA\u6B8B\u7559\uFF1A${temporaryDirectory}\u3002\u8BF7\u786E\u8BA4\u6E05\u7406\u540E\u4ECE\u5934\u91CD\u8BD5\u3002`
    );
  }
  const currentFacts = await lstat5(temporaryDirectory);
  if (currentFacts.dev !== facts.dev || currentFacts.ino !== facts.ino || !currentFacts.isDirectory()) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `\u4E34\u65F6\u76EE\u5F55\u5728\u786E\u8BA4\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF1A${temporaryDirectory}\u3002Narracut \u62D2\u7EDD\u5220\u9664\u3002`
    );
  }
  await rm5(temporaryDirectory, { recursive: true });
}
function starterLockfile() {
  return `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      react:
        specifier: ${STARTER_REACT_VERSION}
        version: ${STARTER_REACT_VERSION}
      react-dom:
        specifier: ${STARTER_REACT_VERSION}
        version: ${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION})
      remotion:
        specifier: ${STARTER_REMOTION_VERSION}
        version: ${STARTER_REMOTION_VERSION}(react-dom@${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION}))(react@${STARTER_REACT_VERSION})

packages:

  react-dom@${STARTER_REACT_VERSION}:
    resolution: {integrity: sha512-rVprimfGBG3DR+Tq0IQG2DT5PxKth1WIGDmj5yPmlzr4YBe7uyE+Du4oVqTDXZSHGGGXRtTJEGSSePyQCMBglQ==}
    peerDependencies:
      react: ^${STARTER_REACT_VERSION}

  react@${STARTER_REACT_VERSION}:
    resolution: {integrity: sha512-PWaYA1L/q9u2u7xYQi+Y3L3Yfnie7XyLeaJICV1MGD6LprsBxcAqGjYyr0eY3p+QdsA+x/Irkt4Qif8D63+Sbw==}
    engines: {node: '>=0.10.0'}

  remotion@${STARTER_REMOTION_VERSION}:
    resolution: {integrity: sha512-L47ImosLFn/uSEGhgV6nO9agEjrRTD+xfeIC4QlGSkCkHjG4IpH2dm0psRoLrK0eo8iiUc4rwUFNnNxQpLnx2w==}
    peerDependencies:
      react: '>=16.8.0'
      react-dom: '>=16.8.0'

  scheduler@0.27.0:
    resolution: {integrity: sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q==}

snapshots:

  react-dom@${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION}):
    dependencies:
      react: ${STARTER_REACT_VERSION}
      scheduler: 0.27.0

  react@${STARTER_REACT_VERSION}: {}

  remotion@${STARTER_REMOTION_VERSION}(react-dom@${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION}))(react@${STARTER_REACT_VERSION}):
    dependencies:
      react: ${STARTER_REACT_VERSION}
      react-dom: ${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION})

  scheduler@0.27.0: {}
`;
}
function starterManifest(projectId) {
  return JSON.stringify({ kind: "narracut-project", formatVersion: 1, projectId });
}
function starterCurrent(revisionId) {
  return JSON.stringify({ revisionId });
}
function starterRevision(revisionId) {
  return JSON.stringify({
    revisionId,
    previousRevisionId: null,
    briefFingerprint: revisionOf(Buffer.alloc(0)),
    source: "starter",
    summary: "Narracut starter Render Program"
  });
}
function starterProgramManifest() {
  return JSON.stringify({ apiVersion: 1, output: { width: 1920, height: 1080, fps: 30 } });
}
function starterPackageManifest() {
  return JSON.stringify({
    private: true,
    dependencies: {
      react: STARTER_REACT_VERSION,
      "react-dom": STARTER_REACT_VERSION,
      remotion: STARTER_REMOTION_VERSION
    }
  });
}
function starterSource() {
  return 'import { AbsoluteFill } from "remotion";\n\ntype RenderProgramInputV1 = Readonly<{ apiVersion: 1 }>;\n\nexport function RenderProgram(input: RenderProgramInputV1) {\n  void input;\n  return <AbsoluteFill style={{ backgroundColor: "#090d0e" }} />;\n}\n';
}
async function writeStarterProject(temporaryDirectory, projectId, revisionId) {
  const renderProgramDirectory = join8(
    temporaryDirectory,
    ".narracut",
    "revisions",
    revisionId,
    "render-program"
  );
  await Promise.all([
    mkdir4(join8(temporaryDirectory, "assets"), { recursive: true }),
    mkdir4(join8(temporaryDirectory, "speech"), { recursive: true }),
    mkdir4(join8(temporaryDirectory, "renders"), { recursive: true }),
    mkdir4(join8(renderProgramDirectory, "src"), { recursive: true }),
    mkdir4(join8(renderProgramDirectory, "resources"), { recursive: true })
  ]);
  await Promise.all([
    writeFile3(join8(temporaryDirectory, "narracut.json"), starterManifest(projectId)),
    writeFile3(join8(temporaryDirectory, "project.json"), '{"assets":[],"scenes":[]}'),
    writeFile3(join8(temporaryDirectory, "video.md"), ""),
    writeFile3(join8(temporaryDirectory, ".narracut", "current.json"), starterCurrent(revisionId)),
    writeFile3(
      join8(temporaryDirectory, ".narracut", "revisions", revisionId, "revision.json"),
      starterRevision(revisionId)
    ),
    writeFile3(join8(renderProgramDirectory, "program.json"), starterProgramManifest()),
    writeFile3(join8(renderProgramDirectory, "package.json"), starterPackageManifest()),
    writeFile3(join8(renderProgramDirectory, "pnpm-lock.yaml"), starterLockfile()),
    writeFile3(join8(renderProgramDirectory, "src", "RenderProgram.tsx"), starterSource())
  ]);
}
async function validateStarterProject(temporaryDirectory, projectId, revisionId) {
  const renderProgramDirectory = join8(
    temporaryDirectory,
    ".narracut",
    "revisions",
    revisionId,
    "render-program"
  );
  const [
    inspection,
    manifest,
    projectDsl,
    videoBrief,
    current,
    revision,
    programManifest,
    packageManifest2,
    lockfile,
    source
  ] = await Promise.all([
    inspectProjectVNext(temporaryDirectory),
    readFile5(join8(temporaryDirectory, "narracut.json"), "utf8"),
    readFile5(join8(temporaryDirectory, "project.json"), "utf8"),
    readFile5(join8(temporaryDirectory, "video.md"), "utf8"),
    readFile5(join8(temporaryDirectory, ".narracut", "current.json"), "utf8"),
    readFile5(join8(temporaryDirectory, ".narracut", "revisions", revisionId, "revision.json"), "utf8"),
    readFile5(join8(renderProgramDirectory, "program.json"), "utf8"),
    readFile5(join8(renderProgramDirectory, "package.json"), "utf8"),
    readFile5(join8(renderProgramDirectory, "pnpm-lock.yaml"), "utf8"),
    readFile5(join8(renderProgramDirectory, "src", "RenderProgram.tsx"), "utf8")
  ]);
  if (inspection.manifest.projectId !== projectId || inspection.project.assets.length !== 0 || inspection.project.scenes.length !== 0 || inspection.videoBrief !== "" || manifest !== starterManifest(projectId) || projectDsl !== '{"assets":[],"scenes":[]}' || videoBrief !== "" || current !== starterCurrent(revisionId) || revision !== starterRevision(revisionId) || programManifest !== starterProgramManifest() || packageManifest2 !== starterPackageManifest() || lockfile !== starterLockfile() || source !== starterSource()) {
    throw new Error("starter \u9879\u76EE\u590D\u6838\u7ED3\u679C\u4E0E\u521B\u5EFA\u8F93\u5165\u4E0D\u4E00\u81F4\u3002");
  }
}
var INTERNAL_JSON_LIMITS = {
  maxDepth: 8,
  maxArrayItems: 32,
  maxObjectFields: 64,
  maxNodes: 256,
  maxStringScalars: 4096,
  maxStringBytes: 16384,
  maxNumberBytes: 32
};
var UUID_PATTERN2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readRegularUtf8(path, maxBytes) {
  const facts = await lstat5(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > maxBytes) {
    throw new Error(`\u4E0D\u662F\u53D7\u652F\u6301\u7684\u666E\u901A\u6587\u4EF6\uFF1A${path}`);
  }
  return readFile5(path, "utf8");
}
async function validateCurrentProjectState(inspection) {
  const projectDirectory = inspection.projectDirectory;
  const currentPath = join8(projectDirectory, ".narracut", "current.json");
  let briefRevision = null;
  try {
    const current = parseStrictJson(
      await readRegularUtf8(currentPath, 4096),
      INTERNAL_JSON_LIMITS
    );
    if (!isPlainRecord(current) || Object.keys(current).length !== 1 || typeof current.revisionId !== "string" || !UUID_PATTERN2.test(current.revisionId)) {
      throw new Error("\u5F53\u524D\u4FEE\u8BA2\u6307\u9488\u65E0\u6548\u3002");
    }
    const revisionId = current.revisionId;
    const revisionDirectory = join8(projectDirectory, ".narracut", "revisions", revisionId);
    const renderProgramDirectory = join8(revisionDirectory, "render-program");
    if (!inspection.renderPrograms.directories.includes(renderProgramDirectory)) {
      throw new Error("\u5F53\u524D\u4FEE\u8BA2\u6CA1\u6709\u53EF\u68C0\u67E5\u7684 Render Program\u3002");
    }
    const [revision, program, packageJson, lockfile, source] = await Promise.all([
      readRegularUtf8(join8(revisionDirectory, "revision.json"), 16384).then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join8(renderProgramDirectory, "program.json"), 16384).then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join8(renderProgramDirectory, "package.json"), 65536).then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join8(renderProgramDirectory, "pnpm-lock.yaml"), 1048576),
      readRegularUtf8(join8(renderProgramDirectory, "src", "RenderProgram.tsx"), 10485760)
    ]);
    if (!isPlainRecord(revision) || Object.keys(revision).some(
      (key) => !["revisionId", "previousRevisionId", "briefFingerprint", "source", "summary"].includes(key)
    ) || revision.revisionId !== revisionId || !(revision.previousRevisionId === null || typeof revision.previousRevisionId === "string" && UUID_PATTERN2.test(revision.previousRevisionId)) || revision.briefFingerprint !== void 0 && (typeof revision.briefFingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(revision.briefFingerprint)) || typeof revision.source !== "string" || typeof revision.summary !== "string") {
      throw new Error("\u5F53\u524D\u4FEE\u8BA2\u5143\u6570\u636E\u65E0\u6548\u3002");
    }
    const output = isPlainRecord(program) && isPlainRecord(program.output) ? program.output : null;
    if (!isPlainRecord(program) || program.apiVersion !== 1 || output === null || ![output.width, output.height, output.fps].every(
      (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0
    )) {
      throw new Error("\u5F53\u524D Render Program manifest \u65E0\u6548\u3002");
    }
    if (!isPlainRecord(packageJson) || !isPlainRecord(packageJson.dependencies)) {
      throw new Error("\u5F53\u524D Render Program package manifest \u65E0\u6548\u3002");
    }
    const dependencies = Object.entries(packageJson.dependencies);
    if (packageJson.private !== true || dependencies.length === 0 || dependencies.some(
      ([, version]) => typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)
    ) || dependencies.some(
      ([name, version]) => !lockfile.includes(`      ${name}:
        specifier: ${String(version)}
`)
    ) || !source.includes("export function RenderProgram(input:")) {
      throw new Error("\u5F53\u524D Render Program \u4F9D\u8D56\u6216\u5165\u53E3\u65E0\u6548\u3002");
    }
    briefRevision = typeof revision.briefFingerprint === "string" ? revision.briefFingerprint : null;
  } catch (cause) {
    if (cause instanceof ProjectLifecycleError) throw cause;
    throw new ProjectLifecycleError(
      "PROJECT_CURRENT_INVALID",
      currentPath,
      `\u5F53\u524D Render Program \u4FEE\u8BA2\u65E0\u6548\uFF1A${projectDirectory}\u3002Narracut \u4E0D\u4F1A\u6253\u5F00\u6216\u4FEE\u590D\u8BE5\u9879\u76EE\u3002`,
      { cause }
    );
  }
  return briefRevision;
}
async function captureDirectoryIdentity(path) {
  const facts = await lstat5(path);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new Error(`\u8DEF\u5F84\u4E0D\u662F\u666E\u901A\u76EE\u5F55\uFF1A${path}`);
  }
  return { dev: facts.dev, ino: facts.ino };
}
function hasIdentity(facts, identity2) {
  return facts.dev === identity2.dev && facts.ino === identity2.ino;
}
async function cleanupOwnedTemporaryDirectory(temporaryDirectory, identity2, markerWritten, projectDirectory, operationToken) {
  let facts;
  try {
    facts = await lstat5(temporaryDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, identity2)) {
    throw new Error("\u521B\u5EFA\u4E34\u65F6\u76EE\u5F55\u5DF2\u88AB\u66FF\u6362\uFF0C\u65E0\u6CD5\u8BC1\u660E\u6E05\u7406\u6240\u6709\u6743\u3002");
  }
  if (markerWritten) {
    const marker = JSON.parse(await readRegularUtf8(
      join8(temporaryDirectory, OPERATION_MARKER),
      4096
    ));
    if (!isCreateOperationMarker(marker, projectDirectory, operationToken)) {
      throw new Error("\u521B\u5EFA\u4E34\u65F6\u76EE\u5F55\u6807\u8BB0\u5DF2\u53D8\u5316\uFF0C\u65E0\u6CD5\u8BC1\u660E\u6E05\u7406\u6240\u6709\u6743\u3002");
    }
  }
  await rm5(temporaryDirectory, { recursive: true });
}
async function cleanupTargetReservation(projectDirectory, identity2) {
  let facts;
  try {
    facts = await lstat5(projectDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, identity2)) {
    throw new Error("\u53D1\u5E03\u76EE\u6807\u4FDD\u7559\u76EE\u5F55\u5DF2\u88AB\u66FF\u6362\uFF0C\u65E0\u6CD5\u8BC1\u660E\u6E05\u7406\u6240\u6709\u6743\u3002");
  }
  if ((await readdir5(projectDirectory)).length !== 0) {
    throw new Error("\u53D1\u5E03\u76EE\u6807\u4FDD\u7559\u76EE\u5F55\u51FA\u73B0\u5916\u90E8\u5185\u5BB9\uFF0CNarracut \u62D2\u7EDD\u5220\u9664\u3002");
  }
  await rmdir(projectDirectory);
}
async function createProjectVNext(inputPath, options = {}) {
  const projectDirectory = resolve3(inputPath);
  const projectName = basename(projectDirectory);
  if (projectName === "" || projectName === "." || projectName === "..") {
    throw new ProjectLifecycleError(
      "PROJECT_CREATE_TARGET_INVALID",
      projectDirectory,
      "\u521B\u5EFA\u76EE\u6807\u5FC5\u987B\u662F\u5E26\u6709\u9879\u76EE\u6587\u4EF6\u5939\u540D\u7684\u7EDD\u5BF9\u8DEF\u5F84\u3002"
    );
  }
  const temporaryDirectory = join8(dirname6(projectDirectory), `.${projectName}.narracut-tmp`);
  const createId = options.createId ?? randomUUID6;
  const projectId = createId();
  const revisionId = createId();
  const operationToken = randomUUID6();
  let temporaryIdentity = null;
  let markerWritten = false;
  let targetReservationIdentity = null;
  try {
    if (await pathExists(projectDirectory)) {
      throw new ProjectLifecycleError(
        "PROJECT_CREATE_TARGET_EXISTS",
        projectDirectory,
        `\u521B\u5EFA\u76EE\u6807\u5DF2\u5B58\u5728\uFF1A${projectDirectory}\u3002\u8BF7\u9009\u62E9\u5C1A\u4E0D\u5B58\u5728\u7684\u65B0\u8DEF\u5F84\u3002`
      );
    }
    if (await pathExists(temporaryDirectory)) {
      await removeConfirmedCreateResidue(
        temporaryDirectory,
        projectDirectory,
        options.confirmTemporaryCleanup === true
      );
    }
    await mkdir4(temporaryDirectory);
    temporaryIdentity = await captureDirectoryIdentity(temporaryDirectory);
    await writeFile3(join8(temporaryDirectory, OPERATION_MARKER), JSON.stringify({
      kind: "narracut-operation",
      version: 1,
      operation: "create",
      targetDirectory: projectDirectory,
      operationToken
    }));
    markerWritten = true;
    await writeStarterProject(temporaryDirectory, projectId, revisionId);
    await validateStarterProject(temporaryDirectory, projectId, revisionId);
    if (process.platform !== "win32") {
      try {
        await mkdir4(projectDirectory);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          throw new ProjectLifecycleError(
            "PROJECT_CREATE_TARGET_EXISTS",
            projectDirectory,
            `\u539F\u5B50\u53D1\u5E03\u524D\u76EE\u6807\u5DF2\u7ECF\u51FA\u73B0\uFF1A${projectDirectory}\u3002Narracut \u62D2\u7EDD\u63A5\u7BA1\u3002`,
            { cause: error }
          );
        }
        throw error;
      }
      targetReservationIdentity = await captureDirectoryIdentity(projectDirectory);
    } else if (await pathExists(projectDirectory)) {
      throw new ProjectLifecycleError(
        "PROJECT_CREATE_TARGET_EXISTS",
        projectDirectory,
        `\u539F\u5B50\u53D1\u5E03\u524D\u76EE\u6807\u5DF2\u7ECF\u51FA\u73B0\uFF1A${projectDirectory}\u3002Narracut \u62D2\u7EDD\u63A5\u7BA1\u3002`
      );
    }
    await unlink(join8(temporaryDirectory, OPERATION_MARKER));
    markerWritten = false;
    if (targetReservationIdentity !== null) {
      const currentReservation = await lstat5(projectDirectory);
      if (!currentReservation.isDirectory() || currentReservation.isSymbolicLink() || !hasIdentity(currentReservation, targetReservationIdentity) || (await readdir5(projectDirectory)).length !== 0) {
        throw new ProjectLifecycleError(
          "PROJECT_CREATE_TARGET_EXISTS",
          projectDirectory,
          `\u539F\u5B50\u53D1\u5E03\u65F6\u76EE\u6807\u4FDD\u7559\u76EE\u5F55\u53D1\u751F\u53D8\u5316\uFF1A${projectDirectory}\u3002Narracut \u62D2\u7EDD\u8986\u76D6\u3002`
        );
      }
    }
    await rename3(temporaryDirectory, projectDirectory);
    temporaryIdentity = null;
    targetReservationIdentity = null;
    return { projectDirectory, projectId, revisionId };
  } catch (cause) {
    try {
      if (targetReservationIdentity !== null) {
        await cleanupTargetReservation(projectDirectory, targetReservationIdentity);
      }
      if (temporaryIdentity !== null) {
        await cleanupOwnedTemporaryDirectory(
          temporaryDirectory,
          temporaryIdentity,
          markerWritten,
          projectDirectory,
          operationToken
        );
      }
    } catch (cleanupCause) {
      throw new ProjectLifecycleError(
        "PROJECT_CREATE_CLEANUP_FAILED",
        temporaryDirectory,
        `\u521B\u5EFA\u5931\u8D25\uFF0C\u4E14\u65E0\u6CD5\u8BC1\u660E\u4E34\u65F6\u4EA7\u7269\u4ECD\u5F52\u672C\u6B21\u64CD\u4F5C\u6240\u6709\uFF1B\u5DF2\u4FDD\u7559\u73B0\u573A\uFF1A${temporaryDirectory}\u3002`,
        { cause: cleanupCause }
      );
    }
    if (cause instanceof ProjectLifecycleError) throw cause;
    throw new ProjectLifecycleError(
      "PROJECT_CREATE_FAILED",
      projectDirectory,
      `\u65E0\u6CD5\u521B\u5EFA Project VNext\uFF1A${projectDirectory}\u3002`,
      { cause }
    );
  }
}
async function readProcessIdentity(pid) {
  if (process.platform !== "linux") return null;
  try {
    const statBytes = await readFile5(`/proc/${pid}/stat`, "utf8");
    const commandEnd = statBytes.lastIndexOf(")");
    if (commandEnd < 0) return null;
    return statBytes.slice(commandEnd + 2).trim().split(/\s+/u)[19] ?? null;
  } catch {
    return null;
  }
}
async function leaseHolderIsAlive(marker) {
  if (!Number.isSafeInteger(marker.pid) || marker.pid <= 0) return true;
  try {
    process.kill(marker.pid, 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    return true;
  }
  if (marker.processIdentity === null) return true;
  const currentIdentity = await readProcessIdentity(marker.pid);
  return currentIdentity === null || currentIdentity === marker.processIdentity;
}
function isLeaseMarker(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const marker = value;
  return marker.kind === "narracut-project-lease" && marker.version === 1 && typeof marker.projectDirectory === "string" && typeof marker.projectId === "string" && typeof marker.pid === "number" && (marker.processIdentity === null || typeof marker.processIdentity === "string") && typeof marker.token === "string";
}
async function clearStaleLease(leasePath) {
  let facts;
  let marker;
  try {
    facts = await lstat5(leasePath);
    if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > 4096) return false;
    marker = JSON.parse(await readFile5(leasePath, "utf8"));
  } catch {
    return false;
  }
  if (!isLeaseMarker(marker) || await leaseHolderIsAlive(marker)) return false;
  const currentFacts = await lstat5(leasePath);
  if (currentFacts.dev !== facts.dev || currentFacts.ino !== facts.ino) return false;
  await unlink(leasePath);
  return true;
}
async function acquireProjectLease(inspection) {
  const projectDirectory = inspection.projectDirectory;
  const leasePath = join8(projectDirectory, ".narracut", "workspace.lease");
  if (activeLeasePaths.has(leasePath)) {
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `\u9879\u76EE\u5DF2\u7531\u53E6\u4E00\u4E2A Narracut \u5DE5\u4F5C\u533A\u5360\u7528\uFF1A${projectDirectory}\u3002`
    );
  }
  const marker = {
    kind: "narracut-project-lease",
    version: 1,
    projectDirectory,
    projectId: inspection.manifest.projectId,
    pid: process.pid,
    processIdentity: await readProcessIdentity(process.pid),
    token: randomUUID6()
  };
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await openFile(leasePath, "wx", 384);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (attempt === 0 && await clearStaleLease(leasePath)) continue;
      throw new ProjectLifecycleError(
        "PROJECT_IN_USE",
        projectDirectory,
        `\u9879\u76EE\u5DF2\u7531\u53E6\u4E00\u4E2A Narracut \u5DE5\u4F5C\u533A\u5360\u7528\uFF1A${projectDirectory}\u3002`,
        { cause: error }
      );
    }
  }
  if (handle === void 0) {
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `\u65E0\u6CD5\u53D6\u5F97\u9879\u76EE\u5199\u5165\u79DF\u7EA6\uFF1A${projectDirectory}\u3002`
    );
  }
  try {
    await handle.writeFile(JSON.stringify(marker));
    await handle.sync();
  } catch (cause) {
    await handle.close();
    await rm5(leasePath, { force: true });
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `\u65E0\u6CD5\u5199\u5165\u9879\u76EE\u79DF\u7EA6\uFF1A${projectDirectory}\u3002`,
      { cause }
    );
  }
  await handle.close();
  let leaseDirectoryHandle;
  try {
    leaseDirectoryHandle = await openFile(dirname6(leasePath), "r");
  } catch (cause) {
    await rm5(leasePath, { force: true });
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `\u65E0\u6CD5\u951A\u5B9A\u9879\u76EE\u79DF\u7EA6\u76EE\u5F55\uFF1A${projectDirectory}\u3002`,
      { cause }
    );
  }
  activeLeasePaths.add(leasePath);
  let released = false;
  const assertCurrent = async () => {
    if (released) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        projectDirectory,
        "\u9879\u76EE\u5DE5\u4F5C\u533A\u79DF\u7EA6\u5DF2\u7ECF\u91CA\u653E\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u3002"
      );
    }
    try {
      const current = JSON.parse(await readFile5(leasePath, "utf8"));
      if (current.token !== marker.token || current.projectId !== marker.projectId) throw new Error("\u79DF\u7EA6\u8EAB\u4EFD\u4E0D\u5339\u914D");
    } catch (cause) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        projectDirectory,
        "\u9879\u76EE\u5199\u5165\u79DF\u7EA6\u5DF2\u7ECF\u5931\u6548\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u5E76\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002",
        { cause }
      );
    }
  };
  const release2 = async () => {
    if (released) return;
    released = true;
    activeLeasePaths.delete(leasePath);
    const anchoredLeasePath = process.platform === "win32" ? leasePath : `/dev/fd/${leaseDirectoryHandle.fd}/workspace.lease`;
    try {
      const current = JSON.parse(await readFile5(anchoredLeasePath, "utf8"));
      if (current.token === marker.token) await unlink(anchoredLeasePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    } finally {
      await leaseDirectoryHandle.close();
    }
  };
  return { assertCurrent, release: release2 };
}
function revisionOf(bytes) {
  return `sha256:${createHash9("sha256").update(bytes).digest("hex")}`;
}
async function currentProjectRevision(projectFile, message) {
  try {
    return await readProjectVNextRevision(projectFile);
  } catch (cause) {
    throw new ProjectLifecycleError(
      "PROJECT_SAVE_CONFLICT",
      projectFile,
      message,
      { cause }
    );
  }
}
function assertWorkbenchMutation(current, next, projectPath) {
  if (JSON.stringify(current.assets) !== JSON.stringify(next.assets)) {
    throw new ProjectLifecycleError(
      "PROJECT_SAVE_FAILED",
      projectPath,
      "\u672C\u6B21\u4FDD\u5B58\u53EA\u80FD\u4FEE\u6539 Scene\uFF1BAsset \u767B\u8BB0\u8868\u5FC5\u987B\u4FDD\u6301\u4E0D\u53D8\u3002"
    );
  }
  const currentScenes = new Map(current.scenes.map((scene) => [scene.id, scene]));
  for (const scene of next.scenes) {
    const previous = currentScenes.get(scene.id);
    if (previous === void 0) {
      if (scene.speech !== void 0) {
        throw new ProjectLifecycleError(
          "PROJECT_SAVE_FAILED",
          projectPath,
          "\u65B0\u589E\u6216\u590D\u5236\u7684 Scene \u4E0D\u80FD\u521B\u5EFA Speech\uFF1B\u8BF7\u4ECE\u8868\u683C\u5DE5\u4F5C\u533A\u91CD\u8BD5\u3002"
        );
      }
      continue;
    }
    if (scene.narration.text !== previous.narration.text && scene.speech !== void 0) {
      throw new ProjectLifecycleError(
        "PROJECT_SAVE_FAILED",
        projectPath,
        `Scene ${scene.id} \u4FEE\u6539 Narration \u540E\u5FC5\u987B\u79FB\u9664\u5931\u6548 Speech\u3002`
      );
    }
    if (scene.speech !== void 0 && JSON.stringify(scene.speech) !== JSON.stringify(previous.speech)) {
      throw new ProjectLifecycleError(
        "PROJECT_SAVE_FAILED",
        projectPath,
        `Scene ${scene.id} \u7684 Speech \u4E0D\u5C5E\u4E8E\u672C\u7968\u53EF\u5199\u8303\u56F4\u3002`
      );
    }
  }
}
function assetSourceRejection(inspection, code, message) {
  return { status: "rejected", code, message, asset: null, inspection };
}
var MAX_ASSET_FILENAME_BYTES = 255;
function truncateUtf8(value, maxBytes) {
  let result = value;
  while (Buffer.byteLength(result, "utf8") > maxBytes) result = [...result].slice(0, -1).join("");
  return result;
}
function safeAssetFilename(sourcePath) {
  const original = basename(sourcePath).replace(/[\u0000-\u001f\u007f]/gu, "_");
  const fallback = original === "" || original === "." || original === ".." ? "asset" : original;
  if (Buffer.byteLength(fallback, "utf8") <= MAX_ASSET_FILENAME_BYTES) return fallback;
  const extensionIndex = fallback.lastIndexOf(".");
  const extension = extensionIndex > 0 && Buffer.byteLength(fallback.slice(extensionIndex), "utf8") <= 64 ? fallback.slice(extensionIndex) : "";
  const stem = truncateUtf8(
    extension === "" ? fallback : fallback.slice(0, extensionIndex),
    MAX_ASSET_FILENAME_BYTES - Buffer.byteLength(extension, "utf8")
  );
  return `${stem || "asset"}${extension}`;
}
function suffixedAssetFilename(filename, suffix) {
  const extensionIndex = filename.lastIndexOf(".");
  const stem = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : "";
  const marker = suffix === 1 ? "" : `-${suffix}`;
  const stemBudget = MAX_ASSET_FILENAME_BYTES - Buffer.byteLength(marker, "utf8") - Buffer.byteLength(extension, "utf8");
  return `${truncateUtf8(stem, Math.max(1, stemBudget)) || "asset"}${marker}${extension}`;
}
async function uniqueAssetPath(assetsDirectory, sourcePath) {
  const filename = safeAssetFilename(sourcePath);
  for (let suffix = 1; suffix <= 1e4; suffix += 1) {
    const candidate = suffixedAssetFilename(filename, suffix);
    const relativePath = `assets/${candidate}`;
    try {
      await access(join8(assetsDirectory, candidate));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return relativePath;
      throw error;
    }
  }
  return `assets/${randomUUID6()}`;
}
async function isProjectControlFile(projectDirectory, sourcePath, sourceFacts) {
  for (const name of ["narracut.json", "project.json", "video.md"]) {
    const controlPath = join8(projectDirectory, name);
    if (resolve3(sourcePath) === controlPath) return true;
    const controlFacts = await lstat5(controlPath);
    if (sourceFacts.dev === controlFacts.dev && sourceFacts.ino === controlFacts.ino) return true;
  }
  return false;
}
async function copyStableFile(source, opened, temporaryPath, assertDestinationCurrent) {
  let destination = null;
  try {
    await assertDestinationCurrent();
    destination = await openFile(temporaryPath, "wx", 384);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(buffer, written, bytesRead - written, position + written);
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await destination.sync();
    const after = await source.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || position !== opened.size) {
      throw new Error("\u5BFC\u5165\u6E90\u5728\u590D\u5236\u671F\u95F4\u53D1\u751F\u53D8\u5316\u3002");
    }
  } finally {
    await destination?.close().catch(() => void 0);
  }
}
async function replaceProjectFile(projectFile, bytes, assertWritable) {
  const temporaryFile = join8(dirname6(projectFile), `.${basename(projectFile)}.${randomUUID6()}.tmp`);
  let committed = false;
  try {
    const handle = await openFile(temporaryFile, "wx", 384);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertWritable();
    await rename3(temporaryFile, projectFile);
    committed = true;
    try {
      const directory2 = await openFile(dirname6(projectFile), "r");
      try {
        await directory2.sync();
      } finally {
        await directory2.close();
      }
    } catch {
    }
  } finally {
    if (!committed) await rm5(temporaryFile, { force: true }).catch(() => void 0);
  }
}
async function openProjectVNext(inputPath, options = {}) {
  const projectDirectory = await realpath4(resolve3(inputPath)).catch(() => resolve3(inputPath));
  try {
    const initialInspection = await inspectProjectVNext(projectDirectory, options);
    await validateCurrentProjectState(initialInspection);
    const directoryIdentity = await captureDirectoryIdentity(projectDirectory);
    const lease = await acquireProjectLease(initialInspection);
    let assetsDirectoryHandle = null;
    let speechDirectoryHandle = null;
    try {
      const inspection = await inspectProjectVNext(projectDirectory, options);
      const acceptedBriefRevision = await validateCurrentProjectState(inspection);
      inspection.currentRenderProgram = {
        briefRevision: acceptedBriefRevision,
        briefReviewPending: acceptedBriefRevision !== inspection.videoBriefRevision,
        previewPreserved: true
      };
      if (inspection.manifest.projectId !== initialInspection.manifest.projectId) {
        throw new ProjectLifecycleError(
          "PROJECT_IDENTITY_LOST",
          projectDirectory,
          `\u53D6\u5F97\u79DF\u7EA6\u65F6\u9879\u76EE\u8EAB\u4EFD\u53D1\u751F\u53D8\u5316\uFF1A${projectDirectory}\u3002`
        );
      }
      const assetsDirectory = join8(projectDirectory, "assets");
      const assetsDirectoryIdentity = await captureDirectoryIdentity(assetsDirectory);
      assetsDirectoryHandle = await openFile(assetsDirectory, "r");
      const openedAssetsDirectory = await assetsDirectoryHandle.stat();
      if (!openedAssetsDirectory.isDirectory() || !hasIdentity(openedAssetsDirectory, assetsDirectoryIdentity)) {
        throw new ProjectLifecycleError(
          "PROJECT_IDENTITY_LOST",
          assetsDirectory,
          "Asset \u76EE\u5F55\u8EAB\u4EFD\u5728\u6253\u5F00\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u3002"
        );
      }
      const anchoredAssetsDirectory = process.platform === "win32" ? assetsDirectory : `/dev/fd/${assetsDirectoryHandle.fd}`;
      const speechDirectory = join8(projectDirectory, "speech");
      const speechDirectoryIdentity = await captureDirectoryIdentity(speechDirectory);
      speechDirectoryHandle = await openFile(speechDirectory, "r");
      const openedSpeechDirectory = await speechDirectoryHandle.stat();
      if (!openedSpeechDirectory.isDirectory() || !hasIdentity(openedSpeechDirectory, speechDirectoryIdentity)) {
        throw new ProjectLifecycleError(
          "PROJECT_IDENTITY_LOST",
          speechDirectory,
          "Speech \u76EE\u5F55\u8EAB\u4EFD\u5728\u6253\u5F00\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u3002"
        );
      }
      const anchoredSpeechDirectory = process.platform === "win32" ? speechDirectory : `/dev/fd/${speechDirectoryHandle.fd}`;
      let currentInspection = inspection;
      let saveQueue = Promise.resolve();
      let closing = false;
      let releasePromise = null;
      const assertWritable = async () => {
        await lease.assertCurrent();
        let facts;
        try {
          facts = await lstat5(projectDirectory);
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u76EE\u5F55\u5DF2\u7ECF\u79FB\u52A8\u6216\u4E0D\u53EF\u7528\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u5E76\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002",
            { cause }
          );
        }
        if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, directoryIdentity)) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u76EE\u5F55\u8EAB\u4EFD\u5DF2\u7ECF\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u5E76\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002"
          );
        }
        try {
          const manifestPath = join8(projectDirectory, "narracut.json");
          const manifestFacts = await lstat5(manifestPath);
          if (!manifestFacts.isFile() || manifestFacts.isSymbolicLink() || manifestFacts.nlink !== 1 || manifestFacts.size > 4096) {
            throw new Error("\u9879\u76EE\u6E05\u5355\u6587\u4EF6\u8EAB\u4EFD\u65E0\u6548");
          }
          const manifest = JSON.parse(await readFile5(manifestPath, "utf8"));
          if (manifest.projectId !== initialInspection.manifest.projectId) {
            throw new Error("\u9879\u76EE\u6E05\u5355\u4E2D\u7684 projectId \u5DF2\u53D8\u5316");
          }
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u6E05\u5355\u8EAB\u4EFD\u5DF2\u7ECF\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u5E76\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002",
            { cause }
          );
        }
      };
      const candidateManager = await createCandidateManager(projectDirectory, assertWritable);
      const candidate = (request) => {
        if (closing) return Promise.reject(new ProjectLifecycleError("PROJECT_IDENTITY_LOST", projectDirectory, "\u9879\u76EE\u6B63\u5728\u5173\u95ED\u3002"));
        const operation = saveQueue.then(() => candidateManager(request));
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      await candidate({ action: "read" });
      const assertAssetsDirectoryCurrent = async () => {
        await assertWritable();
        let facts;
        try {
          facts = await lstat5(assetsDirectory);
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            assetsDirectory,
            "Asset \u76EE\u5F55\u5DF2\u79FB\u52A8\u6216\u4E0D\u53EF\u7528\uFF1BNarracut \u5DF2\u505C\u6B62\u5BFC\u5165\u3002",
            { cause }
          );
        }
        if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, assetsDirectoryIdentity)) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            assetsDirectory,
            "Asset \u76EE\u5F55\u8EAB\u4EFD\u5DF2\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u5BFC\u5165\u3002"
          );
        }
      };
      const assertSpeechDirectoryCurrent = async () => {
        await assertWritable();
        let facts;
        try {
          facts = await lstat5(speechDirectory);
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            speechDirectory,
            "Speech \u76EE\u5F55\u5DF2\u79FB\u52A8\u6216\u4E0D\u53EF\u7528\uFF1BNarracut \u5DF2\u505C\u6B62\u751F\u6210\u3002",
            { cause }
          );
        }
        if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, speechDirectoryIdentity)) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            speechDirectory,
            "Speech \u76EE\u5F55\u8EAB\u4EFD\u5DF2\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u751F\u6210\u3002"
          );
        }
      };
      const saveProject = (project, baselineRevision) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u5DE5\u4F5C\u533A\u6B63\u5728\u5173\u95ED\uFF1BNarracut \u5DF2\u505C\u6B62\u63A5\u6536\u65B0\u7684\u5199\u5165\u3002"
          ));
        }
        const operation = saveQueue.then(async () => {
          const projectFile = join8(projectDirectory, "project.json");
          try {
            await assertWritable();
            if (await currentProjectRevision(
              projectFile,
              "\u65E0\u6CD5\u786E\u8BA4 project.json \u4ECD\u662F\u5F53\u524D\u78C1\u76D8\u57FA\u7EBF\uFF1BNarracut \u5DF2\u505C\u6B62\u81EA\u52A8\u4FDD\u5B58\u3002"
            ) !== baselineRevision) {
              throw new ProjectLifecycleError(
                "PROJECT_SAVE_CONFLICT",
                projectFile,
                "project.json \u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF1BNarracut \u5DF2\u505C\u6B62\u81EA\u52A8\u4FDD\u5B58\uFF0C\u4E0D\u4F1A\u8986\u76D6\u78C1\u76D8\u5185\u5BB9\u3002"
              );
            }
            const validated = validateProjectVNextForSave(project, projectFile);
            assertWorkbenchMutation(currentInspection.project, validated.project, projectFile);
            const { assetStates, speechStates, timeline, warnings } = await validateProjectVNextResources(
              projectDirectory,
              validated.project,
              {
                ...currentInspection.tts.status === "configured" ? { currentTtsProfileId: currentInspection.tts.profileId } : {},
                probeSpeechDurationMs: options.probeSpeechDurationMs
              }
            );
            const nextRevision = revisionOf(validated.bytes);
            if (nextRevision !== baselineRevision) {
              await replaceProjectFile(projectFile, validated.bytes, async () => {
                await assertWritable();
                if (await currentProjectRevision(
                  projectFile,
                  "project.json \u5728\u63D0\u4EA4\u524D\u53D8\u5F97\u4E0D\u53EF\u5B89\u5168\u8BFB\u53D6\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                ) !== baselineRevision) {
                  throw new ProjectLifecycleError(
                    "PROJECT_SAVE_CONFLICT",
                    projectFile,
                    "project.json \u5728\u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                  );
                }
              });
            }
            currentInspection = {
              ...currentInspection,
              project: validated.project,
              projectRevision: nextRevision,
              assetStates,
              speechStates,
              timeline,
              warnings
            };
            return { inspection: currentInspection };
          } catch (cause) {
            if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) {
              throw cause;
            }
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              projectFile,
              "\u65E0\u6CD5\u539F\u5B50\u4FDD\u5B58 project.json\uFF1BNarracut \u5DF2\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002",
              { cause }
            );
          }
        });
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      const saveVideoBrief = (content, baselineRevision) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u5DE5\u4F5C\u533A\u6B63\u5728\u5173\u95ED\uFF1BNarracut \u5DF2\u505C\u6B62\u63A5\u6536\u65B0\u7684\u5199\u5165\u3002"
          ));
        }
        const operation = saveQueue.then(async () => {
          const videoBriefPath = join8(projectDirectory, "video.md");
          try {
            await assertWritable();
            const bytes = Buffer.from(content, "utf8");
            if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== content) {
              throw new ProjectLifecycleError(
                "PROJECT_SAVE_FAILED",
                videoBriefPath,
                "Video Brief \u5305\u542B\u4E0D\u80FD\u8868\u793A\u4E3A\u4E25\u683C UTF-8 \u7684\u5B57\u7B26\uFF1BNarracut \u5DF2\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002"
              );
            }
            if (bytes.length > 2 * 1024 * 1024) {
              throw new ProjectLifecycleError(
                "PROJECT_SAVE_FAILED",
                videoBriefPath,
                `Video Brief \u4E3A ${bytes.length} \u5B57\u8282\uFF0C\u8D85\u8FC7 2 MiB \u4E0A\u9650\uFF1BNarracut \u5DF2\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002`
              );
            }
            const disk = await readVideoBriefVNext(videoBriefPath);
            if (disk.revision !== baselineRevision) return { status: "conflict", disk };
            const nextRevision = revisionOf(bytes);
            if (nextRevision !== baselineRevision) {
              await replaceProjectFile(videoBriefPath, bytes, async () => {
                await assertWritable();
                const current = await readVideoBriefVNext(videoBriefPath);
                if (current.revision !== baselineRevision) {
                  throw new ProjectLifecycleError(
                    "PROJECT_SAVE_CONFLICT",
                    videoBriefPath,
                    "video.md \u5728\u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                  );
                }
              });
            }
            currentInspection = {
              ...currentInspection,
              videoBrief: content,
              videoBriefRevision: nextRevision,
              currentRenderProgram: currentInspection.currentRenderProgram === void 0 ? void 0 : {
                ...currentInspection.currentRenderProgram,
                briefReviewPending: currentInspection.currentRenderProgram.briefRevision !== nextRevision
              }
            };
            return { status: "saved", inspection: currentInspection };
          } catch (cause) {
            if (cause instanceof ProjectLifecycleError && cause.code === "PROJECT_SAVE_CONFLICT") {
              try {
                return { status: "conflict", disk: await readVideoBriefVNext(videoBriefPath) };
              } catch {
                throw cause;
              }
            }
            if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) throw cause;
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              videoBriefPath,
              "\u65E0\u6CD5\u539F\u5B50\u4FDD\u5B58 video.md\uFF1BNarracut \u5DF2\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002",
              { cause }
            );
          }
        });
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      const exportVideoBriefLocal = async (content, targetDirectory) => {
        await assertWritable();
        const bytes = Buffer.from(content, "utf8");
        if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== content || bytes.length > 2 * 1024 * 1024) {
          throw new ProjectLifecycleError(
            "PROJECT_SAVE_FAILED",
            projectDirectory,
            "Video Brief LOCAL \u5FC5\u987B\u662F\u6700\u591A 2 MiB \u7684\u4E25\u683C UTF-8\uFF1BNarracut \u62D2\u7EDD\u5BFC\u51FA\u3002"
          );
        }
        const destinationDirectory = await realpath4(resolve3(targetDirectory)).catch((cause) => {
          throw new ProjectLifecycleError(
            "PROJECT_SAVE_FAILED",
            resolve3(targetDirectory),
            "\u65E0\u6CD5\u8BBF\u95EE Video Brief LOCAL \u5BFC\u51FA\u76EE\u5F55\u3002",
            { cause }
          );
        });
        const relation = relative3(projectDirectory, destinationDirectory);
        if (relation === "" || !relation.startsWith(`..${sep2}`) && relation !== ".." && !isAbsolute3(relation)) {
          throw new ProjectLifecycleError(
            "PROJECT_SAVE_FAILED",
            destinationDirectory,
            "Video Brief LOCAL \u53EA\u80FD\u5BFC\u51FA\u5230\u9879\u76EE\u76EE\u5F55\u4E4B\u5916\u3002"
          );
        }
        const facts = await lstat5(destinationDirectory);
        if (!facts.isDirectory() || facts.isSymbolicLink()) {
          throw new ProjectLifecycleError(
            "PROJECT_SAVE_FAILED",
            destinationDirectory,
            "Video Brief LOCAL \u5BFC\u51FA\u76EE\u6807\u5FC5\u987B\u662F\u666E\u901A\u76EE\u5F55\u3002"
          );
        }
        for (let suffix = 1; suffix <= 1e4; suffix += 1) {
          const filename = suffix === 1 ? "video-brief-local.md" : `video-brief-local-${suffix}.md`;
          const path = join8(destinationDirectory, filename);
          let handle = null;
          try {
            handle = await openFile(path, "wx", 384);
            await handle.writeFile(bytes);
            await handle.sync();
            return { path, bytes: bytes.length, revision: revisionOf(bytes) };
          } catch (cause) {
            if (cause instanceof Error && "code" in cause && cause.code === "EEXIST") continue;
            if (handle !== null) {
              const openedFacts = await handle.stat().catch(() => null);
              const currentFacts = await lstat5(path).catch(() => null);
              if (openedFacts !== null && currentFacts !== null && openedFacts.dev === currentFacts.dev && openedFacts.ino === currentFacts.ino) await unlink(path).catch(() => void 0);
            }
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              path,
              "\u65E0\u6CD5\u5BFC\u51FA Video Brief LOCAL\uFF1BNarracut \u6CA1\u6709\u8986\u76D6\u5DF2\u6709\u6587\u4EF6\u3002",
              { cause }
            );
          } finally {
            await handle?.close().catch(() => void 0);
          }
        }
        throw new ProjectLifecycleError(
          "PROJECT_SAVE_FAILED",
          destinationDirectory,
          "\u5BFC\u51FA\u76EE\u5F55\u4E2D\u5DF2\u6709\u8FC7\u591A\u540C\u540D Video Brief LOCAL \u6587\u4EF6\uFF1BNarracut \u6CA1\u6709\u8986\u76D6\u5B83\u4EEC\u3002"
        );
      };
      const importAsset = (input) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u5DE5\u4F5C\u533A\u6B63\u5728\u5173\u95ED\uFF1BNarracut \u5DF2\u505C\u6B62\u63A5\u6536\u65B0\u7684\u5199\u5165\u3002"
          ));
        }
        const operation = saveQueue.then(async () => {
          const projectFile = join8(projectDirectory, "project.json");
          const sourcePath = resolve3(input.sourcePath);
          await assertWritable();
          if (await currentProjectRevision(
            projectFile,
            "\u65E0\u6CD5\u786E\u8BA4 project.json \u4ECD\u662F\u5F53\u524D\u78C1\u76D8\u57FA\u7EBF\uFF1BNarracut \u5DF2\u505C\u6B62\u5BFC\u5165\u3002"
          ) !== input.baselineRevision) {
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_CONFLICT",
              projectFile,
              "project.json \u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF1BNarracut \u5DF2\u505C\u6B62\u5BFC\u5165\uFF0C\u4E0D\u4F1A\u8986\u76D6\u78C1\u76D8\u5185\u5BB9\u3002"
            );
          }
          let pathFacts;
          try {
            pathFacts = await lstat5(sourcePath);
          } catch (cause) {
            return {
              status: "failed",
              code: "ASSET_SOURCE_UNAVAILABLE",
              message: "\u65E0\u6CD5\u8BFB\u53D6\u5BFC\u5165\u6E90\uFF1B\u8BF7\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u4ECD\u5B58\u5728\u4E14\u53EF\u8BBF\u95EE\u3002",
              asset: null,
              inspection: currentInspection
            };
          }
          if (pathFacts.isSymbolicLink()) {
            return assetSourceRejection(
              currentInspection,
              "ASSET_SOURCE_SYMBOLIC_LINK",
              "\u5BFC\u5165\u6E90\u662F\u7B26\u53F7\u94FE\u63A5\uFF1B\u8BF7\u9009\u62E9\u94FE\u63A5\u6307\u5411\u7684\u666E\u901A\u6587\u4EF6\u3002"
            );
          }
          if (!pathFacts.isFile()) {
            return assetSourceRejection(
              currentInspection,
              "ASSET_SOURCE_NOT_FILE",
              pathFacts.isDirectory() ? "\u5BFC\u5165\u6E90\u662F\u76EE\u5F55\uFF1B\u8BF7\u9009\u62E9\u4E00\u4E2A\u6216\u591A\u4E2A\u666E\u901A\u6587\u4EF6\u3002" : "\u5BFC\u5165\u6E90\u4E0D\u662F\u666E\u901A\u6587\u4EF6\uFF1B\u8BF7\u9009\u62E9\u53EF\u590D\u5236\u7684\u666E\u901A\u6587\u4EF6\u3002"
            );
          }
          let source;
          try {
            source = await openFile(sourcePath, fsConstants2.O_RDONLY | (fsConstants2.O_NOFOLLOW ?? 0));
          } catch (cause) {
            return {
              status: "failed",
              code: "ASSET_SOURCE_UNAVAILABLE",
              message: "\u65E0\u6CD5\u5B89\u5168\u6253\u5F00\u5BFC\u5165\u6E90\uFF1B\u8BF7\u91CD\u65B0\u9009\u62E9\u6587\u4EF6\u3002",
              asset: null,
              inspection: currentInspection
            };
          }
          try {
            const sourceFacts = await source.stat();
            if (!sourceFacts.isFile() || !hasIdentity(sourceFacts, pathFacts)) {
              return assetSourceRejection(
                currentInspection,
                "ASSET_SOURCE_CHANGED",
                "\u5BFC\u5165\u6E90\u5728\u6253\u5F00\u65F6\u53D1\u751F\u53D8\u5316\uFF1B\u8BF7\u91CD\u65B0\u9009\u62E9\u6587\u4EF6\u3002"
              );
            }
            if (await isProjectControlFile(projectDirectory, sourcePath, sourceFacts)) {
              return assetSourceRejection(
                currentInspection,
                "ASSET_SOURCE_PROJECT_CONTROL_FILE",
                "\u9879\u76EE\u63A7\u5236\u6587\u4EF6\u4E0D\u80FD\u767B\u8BB0\u4E3A Asset\u3002"
              );
            }
            if (currentInspection.project.assets.length >= 1e3) {
              return assetSourceRejection(
                currentInspection,
                "PROJECT_ASSET_LIMIT_REACHED",
                "\u9879\u76EE\u5DF2\u8FBE\u5230 1,000 \u4E2A Asset \u4E0A\u9650\u3002"
              );
            }
            await assertAssetsDirectoryCurrent();
            const asset = {
              id: randomUUID6(),
              path: await uniqueAssetPath(anchoredAssetsDirectory, sourcePath)
            };
            const temporaryPath = join8(anchoredAssetsDirectory, `.import-${randomUUID6()}.tmp`);
            let finalPath = join8(anchoredAssetsDirectory, basename(asset.path));
            let published = false;
            try {
              await copyStableFile(source, sourceFacts, temporaryPath, assertAssetsDirectoryCurrent);
              for (let attempt = 0; attempt < 1e4; attempt += 1) {
                try {
                  await assertAssetsDirectoryCurrent();
                  await link(temporaryPath, finalPath);
                  published = true;
                  break;
                } catch (cause) {
                  if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) throw cause;
                  asset.path = await uniqueAssetPath(anchoredAssetsDirectory, sourcePath);
                  finalPath = join8(anchoredAssetsDirectory, basename(asset.path));
                }
              }
              if (!published) throw new Error("\u65E0\u6CD5\u4E3A Asset \u5206\u914D\u552F\u4E00\u9879\u76EE\u8DEF\u5F84\u3002");
              await assertAssetsDirectoryCurrent();
              await unlink(temporaryPath);
              const project = structuredClone(currentInspection.project);
              project.assets.push(asset);
              const targetScene = input.targetSceneId === void 0 ? void 0 : project.scenes.find((scene) => scene.id === input.targetSceneId);
              const bound = targetScene !== void 0 && targetScene.assetIds.length < 256;
              if (bound) targetScene.assetIds.push(asset.id);
              const validated = validateProjectVNextForSave(project, projectFile);
              const { assetStates, speechStates, timeline, warnings } = await validateProjectVNextResources(
                projectDirectory,
                validated.project,
                {
                  ...currentInspection.tts.status === "configured" ? { currentTtsProfileId: currentInspection.tts.profileId } : {},
                  probeSpeechDurationMs: options.probeSpeechDurationMs
                }
              );
              const nextRevision = revisionOf(validated.bytes);
              await replaceProjectFile(projectFile, validated.bytes, async () => {
                await assertAssetsDirectoryCurrent();
                if (await currentProjectRevision(
                  projectFile,
                  "project.json \u5728\u63D0\u4EA4\u524D\u53D8\u5F97\u4E0D\u53EF\u5B89\u5168\u8BFB\u53D6\uFF1BNarracut \u62D2\u7EDD\u5B8C\u6210\u5BFC\u5165\u3002"
                ) !== input.baselineRevision) {
                  throw new ProjectLifecycleError(
                    "PROJECT_SAVE_CONFLICT",
                    projectFile,
                    "project.json \u5728\u5BFC\u5165\u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                  );
                }
              });
              currentInspection = {
                ...currentInspection,
                project: validated.project,
                projectRevision: nextRevision,
                assetStates,
                speechStates,
                timeline,
                warnings
              };
              return {
                status: bound ? "imported-and-bound" : "imported-unbound",
                code: bound ? "ASSET_IMPORTED_AND_BOUND" : "ASSET_IMPORTED_UNBOUND",
                message: bound ? "Asset \u5DF2\u5BFC\u5165\u5E76\u7ED1\u5B9A\u5230\u539F\u76EE\u6807 Scene\u3002" : targetScene === void 0 && input.targetSceneId !== void 0 ? "Asset \u5DF2\u5BFC\u5165\uFF1B\u539F\u76EE\u6807 Scene \u5DF2\u4E0D\u5B58\u5728\uFF0C\u56E0\u6B64\u4FDD\u6301\u6682\u672A\u7ED1\u5B9A\u3002" : targetScene !== void 0 ? "Asset \u5DF2\u5BFC\u5165\uFF1B\u539F\u76EE\u6807 Scene \u5DF2\u8FBE\u5230 256 \u4E2A\u5F15\u7528\u4E0A\u9650\uFF0C\u56E0\u6B64\u4FDD\u6301\u6682\u672A\u7ED1\u5B9A\u3002" : "Asset \u5DF2\u5BFC\u5165\u5E76\u767B\u8BB0\u4E3A\u6682\u672A\u7ED1\u5B9A\u3002",
                asset,
                inspection: currentInspection
              };
            } catch (cause) {
              if (published) await unlink(finalPath).catch(() => void 0);
              await unlink(temporaryPath).catch(() => void 0);
              if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) throw cause;
              return {
                status: "failed",
                code: "ASSET_IMPORT_FAILED",
                message: cause instanceof Error ? cause.message : "\u65E0\u6CD5\u590D\u5236\u5E76\u767B\u8BB0 Asset\u3002",
                asset: null,
                inspection: currentInspection
              };
            }
          } finally {
            await source.close().catch(() => void 0);
          }
        });
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      const saveTtsSettings = (input) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u5DE5\u4F5C\u533A\u6B63\u5728\u5173\u95ED\uFF1BNarracut \u5DF2\u505C\u6B62\u63A5\u6536 TTS \u914D\u7F6E\u5199\u5165\u3002"
          ));
        }
        const operation = saveQueue.then(async () => {
          const projectFile = join8(projectDirectory, "project.json");
          await assertWritable();
          if (await currentProjectRevision(
            projectFile,
            "\u65E0\u6CD5\u786E\u8BA4 project.json \u4ECD\u662F\u5F53\u524D\u78C1\u76D8\u57FA\u7EBF\uFF1BNarracut \u5DF2\u505C\u6B62\u4FDD\u5B58 TTS \u914D\u7F6E\u3002"
          ) !== input.baselineRevision) {
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_CONFLICT",
              projectFile,
              "project.json \u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF1BNarracut \u5DF2\u505C\u6B62\u4FDD\u5B58 TTS \u914D\u7F6E\u3002"
            );
          }
          const config = validateProjectTtsConfig(input.config);
          const nextProfileId = ttsProfileId(config);
          const previousProjectBytes = await readFile5(projectFile);
          if (revisionOf(previousProjectBytes) !== currentInspection.projectRevision) {
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_CONFLICT",
              projectFile,
              "project.json \u5728\u5EFA\u7ACB TTS \u914D\u7F6E\u56DE\u6EDA\u951A\u70B9\u65F6\u53D1\u751F\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
            );
          }
          const project = structuredClone(currentInspection.project);
          let affectedSpeechCount = 0;
          for (const scene of project.scenes) {
            if (scene.speech !== void 0 && scene.speech.ttsProfileId !== nextProfileId) {
              affectedSpeechCount += 1;
              delete scene.speech;
            }
          }
          if (affectedSpeechCount !== input.expectedAffectedSpeechCount) {
            throw new ProjectTtsConfirmationError(affectedSpeechCount);
          }
          const validated = validateProjectVNextForSave(project, projectFile);
          const previousProjectRevision = currentInspection.projectRevision;
          const nextRevision = revisionOf(validated.bytes);
          const resourceValidation = await validateProjectVNextResources(
            projectDirectory,
            validated.project,
            {
              currentTtsProfileId: nextProfileId,
              probeSpeechDurationMs: options.probeSpeechDurationMs
            }
          );
          let projectWritten = false;
          try {
            if (nextRevision !== previousProjectRevision) {
              await replaceProjectFile(projectFile, validated.bytes, async () => {
                await assertWritable();
                if (await currentProjectRevision(
                  projectFile,
                  "project.json \u5728 TTS \u914D\u7F6E\u63D0\u4EA4\u524D\u53D8\u5F97\u4E0D\u53EF\u5B89\u5168\u8BFB\u53D6\u3002"
                ) !== previousProjectRevision) {
                  throw new ProjectLifecycleError(
                    "PROJECT_SAVE_CONFLICT",
                    projectFile,
                    "project.json \u5728 TTS \u914D\u7F6E\u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                  );
                }
              });
              projectWritten = true;
            }
            const tts = await writeProjectTtsConfig(projectDirectory, config, assertWritable);
            currentInspection = {
              ...currentInspection,
              project: validated.project,
              projectRevision: nextRevision,
              tts,
              ...resourceValidation
            };
            return { affectedSpeechCount, inspection: currentInspection };
          } catch (cause) {
            if (projectWritten) {
              try {
                await replaceProjectFile(projectFile, previousProjectBytes, async () => {
                  await assertWritable();
                  if (await currentProjectRevision(
                    projectFile,
                    "project.json \u5728 TTS \u914D\u7F6E\u56DE\u6EDA\u524D\u53D8\u5F97\u4E0D\u53EF\u5B89\u5168\u8BFB\u53D6\u3002"
                  ) !== nextRevision) {
                    throw new ProjectLifecycleError(
                      "PROJECT_SAVE_CONFLICT",
                      projectFile,
                      "TTS \u914D\u7F6E\u5931\u8D25\u540E project.json \u53C8\u53D1\u751F\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u5E76\u4FDD\u7559\u73B0\u573A\u3002"
                    );
                  }
                });
              } catch (rollbackCause) {
                throw new ProjectLifecycleError(
                  "PROJECT_SAVE_FAILED",
                  projectFile,
                  "TTS \u914D\u7F6E\u63D0\u4EA4\u5931\u8D25\uFF0C\u4E14 Scene \u5F15\u7528\u56DE\u6EDA\u5931\u8D25\uFF1B\u9879\u76EE\u4FDD\u6301\u65E0\u9648\u65E7 Speech \u7684\u5B89\u5168\u72B6\u6001\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u68C0\u67E5\u3002",
                  { cause: rollbackCause }
                );
              }
            }
            if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) throw cause;
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              join8(projectDirectory, "tts.json"),
              "\u65E0\u6CD5\u539F\u5B50\u4FDD\u5B58 TTS \u914D\u7F6E\uFF1BNarracut \u5DF2\u4FDD\u7559\u539F\u914D\u7F6E\u4E0E Scene \u5185\u5BB9\u3002",
              { cause }
            );
          }
        });
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      const probeSpeechAudio = async (input) => {
        await assertSpeechDirectoryCurrent();
        const probeFile = join8(anchoredSpeechDirectory, `.probe-${input.jobId}.mp3`);
        const decoderPath = process.platform === "linux" ? join8(`/proc/${process.pid}/fd/${speechDirectoryHandle.fd}`, `.probe-${input.jobId}.mp3`) : join8(speechDirectory, `.probe-${input.jobId}.mp3`);
        let created = false;
        try {
          const handle = await openFile(probeFile, "wx", 384);
          created = true;
          try {
            await handle.writeFile(input.audio);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await assertSpeechDirectoryCurrent();
          const durationMs = await (options.probeSpeechDurationMs ?? probeSpeechDurationMs)(decoderPath);
          if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
            throw new Error("Speech \u5B9E\u9645\u65F6\u957F\u5FC5\u987B\u662F\u6B63\u5B89\u5168\u6574\u6570\u3002");
          }
          await assertSpeechDirectoryCurrent();
          return durationMs;
        } finally {
          if (created) await rm5(probeFile, { force: true }).catch(() => void 0);
        }
      };
      const commitSpeech = (input) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u5DE5\u4F5C\u533A\u6B63\u5728\u5173\u95ED\uFF1BNarracut \u5DF2\u505C\u6B62\u63A5\u6536 Speech \u7ED3\u679C\u3002"
          ));
        }
        const operation = saveQueue.then(async () => {
          await assertWritable();
          const tts = await readProjectTtsConfig(projectDirectory);
          if (tts.status !== "configured" || tts.profileId !== input.ttsProfileId) {
            return {
              status: "rejected",
              code: "SPEECH_RESULT_CONFIG_CHANGED",
              message: "\u7ED3\u679C\u672A\u5E94\u7528\uFF1ATTS \u914D\u7F6E\u5DF2\u7ECF\u53D8\u5316\u3002",
              inspection: currentInspection
            };
          }
          const scene = currentInspection.project.scenes.find((candidate2) => candidate2.id === input.sceneId);
          if (scene === void 0) {
            return {
              status: "rejected",
              code: "SPEECH_RESULT_SCENE_DELETED",
              message: "\u7ED3\u679C\u672A\u5E94\u7528\uFF1A\u76EE\u6807 Scene \u5DF2\u5220\u9664\u3002",
              inspection: currentInspection
            };
          }
          if (scene.narration.text !== input.narrationText) {
            return {
              status: "rejected",
              code: "SPEECH_RESULT_NARRATION_CHANGED",
              message: "\u7ED3\u679C\u672A\u5E94\u7528\uFF1ANarration \u5DF2\u7ECF\u53D8\u5316\u3002",
              inspection: currentInspection
            };
          }
          if (input.isCancelled?.()) {
            return {
              status: "rejected",
              code: "SPEECH_RESULT_CANCELLED",
              message: "\u7ED3\u679C\u672A\u5E94\u7528\uFF1ASpeech \u751F\u6210\u5DF2\u7ECF\u53D6\u6D88\u3002",
              inspection: currentInspection
            };
          }
          const finalFile = join8(anchoredSpeechDirectory, `${scene.id}.mp3`);
          const temporaryFile = join8(anchoredSpeechDirectory, `.speech-${randomUUID6()}.tmp`);
          const backupFile = join8(anchoredSpeechDirectory, `.speech-${randomUUID6()}.previous`);
          let previousFile = false;
          let published = false;
          try {
            const handle = await openFile(temporaryFile, "wx", 384);
            try {
              await handle.writeFile(input.audio);
              await handle.sync();
            } finally {
              await handle.close();
            }
            try {
              const finalFacts = await lstat5(finalFile);
              if (!finalFacts.isFile() || finalFacts.isSymbolicLink()) {
                throw new ProjectLifecycleError(
                  "PROJECT_IDENTITY_LOST",
                  finalFile,
                  "\u65E2\u6709 Speech \u4E0D\u518D\u662F\u666E\u901A\u6587\u4EF6\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                );
              }
              await link(finalFile, backupFile);
              const backupFacts = await lstat5(backupFile);
              if (!backupFacts.isFile() || backupFacts.isSymbolicLink() || !hasIdentity(backupFacts, finalFacts)) {
                throw new ProjectLifecycleError(
                  "PROJECT_IDENTITY_LOST",
                  backupFile,
                  "\u65E2\u6709 Speech \u5728\u5EFA\u7ACB\u56DE\u6EDA\u951A\u70B9\u65F6\u53D1\u751F\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                );
              }
              previousFile = true;
            } catch (cause) {
              if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
            }
            await assertSpeechDirectoryCurrent();
            if (input.isCancelled?.()) throw new Error("Speech \u751F\u6210\u5DF2\u7ECF\u53D6\u6D88\u3002");
            await rename3(temporaryFile, finalFile);
            published = true;
            const project = structuredClone(currentInspection.project);
            const target = project.scenes.find((candidate2) => candidate2.id === scene.id);
            target.speech = {
              path: `speech/${scene.id}.mp3`,
              durationMs: input.durationMs,
              sourceTextHash: `sha256:${createHash9("sha256").update(input.narrationText, "utf8").digest("hex")}`,
              ttsProfileId: input.ttsProfileId,
              audioContentHash: `sha256:${createHash9("sha256").update(input.audio).digest("hex")}`
            };
            const projectFile = join8(projectDirectory, "project.json");
            const baselineRevision = currentInspection.projectRevision;
            const validated = validateProjectVNextForSave(project, projectFile);
            const { assetStates, speechStates, timeline, warnings } = await validateProjectVNextResources(
              projectDirectory,
              validated.project,
              {
                currentTtsProfileId: tts.profileId,
                probeSpeechDurationMs: options.probeSpeechDurationMs
              }
            );
            if (speechStates.find((state) => state.sceneId === scene.id)?.status !== "available") {
              throw new Error("\u53D1\u5E03\u540E\u7684 Speech \u672A\u901A\u8FC7\u53EF\u89E3\u7801\u6027\u4E0E\u65F6\u957F\u590D\u6838\u3002");
            }
            if (input.isCancelled?.()) throw new Error("Speech \u751F\u6210\u5DF2\u7ECF\u53D6\u6D88\u3002");
            input.onCommitPoint?.();
            await replaceProjectFile(projectFile, validated.bytes, async () => {
              await assertSpeechDirectoryCurrent();
              if (await currentProjectRevision(
                projectFile,
                "project.json \u5728 Speech \u63D0\u4EA4\u524D\u53D8\u5F97\u4E0D\u53EF\u5B89\u5168\u8BFB\u53D6\u3002"
              ) !== baselineRevision) {
                throw new ProjectLifecycleError(
                  "PROJECT_SAVE_CONFLICT",
                  projectFile,
                  "project.json \u5728 Speech \u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                );
              }
            });
            currentInspection = {
              ...currentInspection,
              project: validated.project,
              projectRevision: revisionOf(validated.bytes),
              tts,
              assetStates,
              speechStates,
              timeline,
              warnings
            };
            await rm5(backupFile, { force: true }).catch(() => void 0);
            return {
              status: "applied",
              code: "SPEECH_APPLIED",
              message: "Speech \u5DF2\u6821\u9A8C\u5E76\u539F\u5B50\u5E94\u7528\u5230\u5F53\u524D Scene\u3002",
              inspection: currentInspection
            };
          } catch (cause) {
            let rollbackFailure;
            if (published) {
              try {
                if (previousFile) {
                  if (process.platform === "win32") await rm5(finalFile, { force: true });
                  await rename3(backupFile, finalFile);
                } else await rm5(finalFile, { force: true });
              } catch (rollbackCause) {
                rollbackFailure = rollbackCause;
              }
            }
            await rm5(temporaryFile, { force: true }).catch(() => void 0);
            if (rollbackFailure === void 0) await rm5(backupFile, { force: true }).catch(() => void 0);
            if (rollbackFailure !== void 0) {
              throw new ProjectLifecycleError(
                "PROJECT_SAVE_FAILED",
                backupFile,
                `Speech \u56DE\u6EDA\u5931\u8D25\uFF1B\u65E7\u97F3\u9891\u5907\u4EFD\u5DF2\u4FDD\u7559\u5728 ${backupFile}\uFF0CNarracut \u4E0D\u4F1A\u58F0\u79F0\u65E7 Speech \u672A\u53D8\u3002`,
                { cause: rollbackFailure }
              );
            }
            if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) throw cause;
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              finalFile,
              "\u65E0\u6CD5\u539F\u5B50\u5E94\u7528 Speech\uFF1B\u65E7 Speech \u4E0E Scene \u5185\u5BB9\u4FDD\u6301\u4E0D\u53D8\u3002",
              { cause }
            );
          }
        });
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      const release2 = async () => {
        closing = true;
        releasePromise ??= saveQueue.then(async () => {
          try {
            await lease.release();
          } finally {
            await assetsDirectoryHandle?.close();
            assetsDirectoryHandle = null;
            await speechDirectoryHandle?.close();
            speechDirectoryHandle = null;
          }
        });
        await releasePromise;
      };
      return {
        candidate,
        readPreviewSource: async (target) => {
          await saveQueue;
          return candidateManager.previewSource(target);
        },
        buildCandidateBundle: async (request) => {
          await saveQueue;
          return candidateManager.build(request);
        },
        inspection,
        saveProject,
        saveVideoBrief,
        exportVideoBriefLocal,
        importAsset,
        saveTtsSettings,
        probeSpeechAudio,
        commitSpeech,
        release: release2
      };
    } catch (error) {
      try {
        await lease.release();
      } finally {
        await assetsDirectoryHandle?.close();
        await speechDirectoryHandle?.close();
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
      throw error;
    }
    throw new ProjectLifecycleError(
      "PROJECT_OPEN_FAILED",
      projectDirectory,
      `\u65E0\u6CD5\u6253\u5F00 Project VNext\uFF1A${projectDirectory}\u3002`,
      { cause: error }
    );
  }
}

// src/server/project-asset-preview.ts
import { constants as fsConstants3 } from "node:fs";
import { lstat as lstat6, open as openFile2 } from "node:fs/promises";
import { basename as basename2, join as join9 } from "node:path";
var MAX_INLINE_PREVIEW_BYTES = 32 * 1024 * 1024;
function startsWith(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}
function ascii(bytes, start, end) {
  return bytes.subarray(start, end).toString("ascii");
}
function detectPreview(bytes) {
  if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
    return { kind: "image", mediaType: "image/png" };
  }
  if (startsWith(bytes, [255, 216, 255])) return { kind: "image", mediaType: "image/jpeg" };
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return { kind: "image", mediaType: "image/gif" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return { kind: "image", mediaType: "image/webp" };
  }
  if (startsWith(bytes, [26, 69, 223, 163])) return { kind: "video", mediaType: "video/webm" };
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    return /^M4A/u.test(brand) ? { kind: "audio", mediaType: "audio/mp4" } : { kind: "video", mediaType: brand === "qt  " ? "video/quicktime" : "video/mp4" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") {
    return { kind: "audio", mediaType: "audio/wav" };
  }
  if (ascii(bytes, 0, 4) === "OggS") return { kind: "audio", mediaType: "audio/ogg" };
  if (ascii(bytes, 0, 3) === "ID3" || bytes[0] === 255 && (bytes[1] ?? 0) >= 224) {
    return { kind: "audio", mediaType: "audio/mpeg" };
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return { kind: "document", mediaType: "application/pdf" };
  return { kind: "unsupported" };
}
async function readProjectAssetPreview(inspection, assetId) {
  const asset = inspection.project.assets.find((item) => item.id === assetId);
  if (asset === void 0) {
    return { status: "dangling", id: assetId, reason: "\u672A\u627E\u5230\u767B\u8BB0\u7684 Asset\u3002" };
  }
  const absolutePath = join9(inspection.projectDirectory, asset.path);
  try {
    const { assetStates: [runtime] } = await validateProjectVNextResources(
      inspection.projectDirectory,
      { assets: [asset], scenes: [] }
    );
    if (runtime?.status !== "available") {
      return {
        status: "unavailable",
        id: asset.id,
        path: asset.path,
        reason: runtime?.reason ?? "Asset \u6587\u4EF6\u4E0D\u53EF\u7528\u3002"
      };
    }
    const before = await lstat6(absolutePath);
    const handle = await openFile2(absolutePath, fsConstants3.O_RDONLY | (fsConstants3.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) {
        return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset \u6587\u4EF6\u8EAB\u4EFD\u5DF2\u53D8\u5316\u3002" };
      }
      const header = Buffer.alloc(Math.min(32, opened.size));
      if (header.length > 0) await handle.read(header, 0, header.length, 0);
      const detected = detectPreview(header);
      const common = {
        status: "available",
        id: asset.id,
        path: asset.path,
        filename: basename2(asset.path),
        size: opened.size,
        ...detected
      };
      if (detected.kind === "unsupported") {
        return { ...common, reason: "\u5F53\u524D\u683C\u5F0F\u4E0D\u652F\u6301\u5185\u5BB9\u9884\u89C8\u3002" };
      }
      if (opened.size > MAX_INLINE_PREVIEW_BYTES) {
        return { ...common, reason: "\u5F53\u524D\u5BBF\u4E3B\u65E0\u6CD5\u5B89\u5168\u52A0\u8F7D\u6B64\u5185\u5BB9\u9884\u89C8\u3002" };
      }
      const bytes = Buffer.alloc(opened.size);
      let position = 0;
      while (position < bytes.length) {
        const { bytesRead } = await handle.read(bytes, position, bytes.length - position, position);
        if (bytesRead === 0) break;
        position += bytesRead;
      }
      if (position !== opened.size) {
        return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset \u5728\u8BFB\u53D6\u671F\u95F4\u53D1\u751F\u53D8\u5316\u3002" };
      }
      const after = await handle.stat();
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
        return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset \u5728\u8BFB\u53D6\u671F\u95F4\u53D1\u751F\u53D8\u5316\u3002" };
      }
      return {
        ...common,
        dataUrl: `data:${detected.mediaType};base64,${bytes.toString("base64")}`
      };
    } finally {
      await handle.close();
    }
  } catch {
    return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset \u6587\u4EF6\u7F3A\u5931\u3001\u65E0\u6CD5\u8BFB\u53D6\u6216\u8EAB\u4EFD\u65E0\u6548\u3002" };
  }
}

// plugins/narracut/src/server.ts
var SERVER_VERSION = "0.1.0";
var MCP_PROTOCOL_VERSION = "2025-06-18";
var WORKBENCH_URI = "ui://narracut/workbench-v1.html";
var WORKBENCH_PATH = fileURLToPath3(new URL(
  import.meta.url.endsWith("/server.mjs") ? "./workbench.html" : "../workbench.html",
  import.meta.url
));
var WORKBENCH_SCRIPT_PATH = fileURLToPath3(new URL(
  import.meta.url.endsWith("/server.mjs") ? "./workbench.js" : "../workbench.js",
  import.meta.url
));
var ASSET_BASE = import.meta.url.endsWith("/server.mjs") ? "./assets/" : "../assets/";
var PAPER_TEXTURE_PATH = fileURLToPath3(new URL(`${ASSET_BASE}contact-paper-texture.webp`, import.meta.url));
var FILM_TEXTURE_PATH = fileURLToPath3(new URL(`${ASSET_BASE}film-edge-texture.webp`, import.meta.url));
var DISPLAY_FONT_PATH = fileURLToPath3(new URL(`${ASSET_BASE}fonts/ubuntu-sans-display.woff2`, import.meta.url));
var readOnlyToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};
var taskToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};
var tools = [
  {
    name: "project_preview",
    title: "\u6784\u5EFA\u4E0E\u68C0\u67E5\u53EA\u8BFB\u6210\u7247 Preview",
    description: "\u53EA\u8BFB\u6784\u5EFA\u5F53\u524D\u6216\u5019\u9009\u7684\u4E0D\u53EF\u53D8 Preview\uFF0C\u6216\u6838\u5BF9\u65E2\u6709\u5B9E\u4F8B\u65B0\u9C9C\u5EA6\u3002\u4E0D\u63A5\u53D7\u5019\u9009\u3001\u4E0D\u5199 Scene\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "action"],
      additionalProperties: false,
      properties: { projectDirectory: { type: "string" }, projectId: { type: "string" }, action: { enum: ["build", "status", "release"] }, target: { enum: ["current", "candidate"] }, parentOrigin: { type: "string" }, instanceId: { type: "string" } }
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "coordinate_project_dependencies",
    title: "\u534F\u8C03\u5019\u9009\u7CBE\u786E\u4F9D\u8D56",
    description: "\u552F\u4E00\u5141\u8BB8\u4FEE\u6539\u5019\u9009\u4F9D\u8D56\u58F0\u660E\u3001pnpm \u9501\u56FE\u4E0E\u9879\u76EE\u79BB\u7EBF\u4F9D\u8D56\u5E93\u7684\u64CD\u4F5C\u3002\u63D0\u4F9B\u7CBE\u786E\u7248\u672C\u548C SHA-512 \u6458\u8981\uFF0C\u4F20\u9012\u4F9D\u8D56\u4E5F\u5FC5\u987B\u7531\u5DF2\u6709\u9501\u56FE\u6216 packages \u663E\u5F0F\u56FA\u5B9A\u3002\u53EA\u4ECE\u56FA\u5B9A\u516C\u5171 npm registry \u4E0B\u8F7D\u5E76\u9A8C\u8BC1\uFF0C\u4E0D\u6267\u884C\u5305\u4EE3\u7801\u6216\u811A\u672C\uFF1B\u5931\u8D25\u4FDD\u7559\u539F\u5019\u9009\u548C\u79BB\u7EBF\u5E93\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baseline", "dependencies", "packages"],
      additionalProperties: false,
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baseline: { type: "string" },
        dependencies: { type: "object", additionalProperties: { type: "string" } },
        packages: { type: "array", maxItems: 256, items: {
          type: "object",
          required: ["name", "version", "integrity"],
          additionalProperties: false,
          properties: { name: { type: "string" }, version: { type: "string" }, integrity: { type: "string" } }
        } }
      }
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, openWorldHint: true }
  },
  {
    name: "manage_project_candidate",
    title: "\u7BA1\u7406\u552F\u4E00\u5019\u9009 Render Program",
    description: "\u5728\u5F53\u524D\u9879\u76EE\u79DF\u7EA6\u5185\u8BFB\u53D6\u3001\u663E\u5F0F\u521B\u5EFA\u3001\u539F\u5B50\u4FEE\u6539\u6216\u786E\u8BA4\u653E\u5F03\u552F\u4E00\u5019\u9009\u3002apply \u4F7F\u7528\u8BFB\u53D6\u6240\u5F97 baseline\uFF1Bchanges \u53EA\u4FEE\u6539 program.json\u3001src/ \u548C resources/\uFF0C\u4E0D\u6267\u884C\u4EE3\u7801\u3001\u4E0D\u4FEE\u6539\u4F9D\u8D56\u6216\u5F53\u524D\u4FEE\u8BA2\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "action"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        action: { type: "string", enum: ["read", "create", "apply", "discard"] },
        baseline: { type: "string" },
        confirmed: { type: "boolean" },
        changes: { type: "array", maxItems: 256, items: {
          type: "object",
          required: ["path", "content"],
          additionalProperties: false,
          properties: { path: { type: "string" }, content: { type: ["string", "null"] } }
        } }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, destructiveHint: true }
  },
  {
    name: "health_check",
    title: "\u68C0\u67E5 Narracut \u8FDE\u63A5",
    description: "\u786E\u8BA4 Narracut \u672C\u5730 MCP \u5DF2\u8FDE\u63A5\uFF0C\u5E76\u8FD4\u56DE\u542F\u52A8\u5668\u4E0E\u9879\u76EE\u5DE5\u4F5C\u53F0\u80FD\u529B\u8FB9\u754C\u3002",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      required: ["status", "server", "readOnly"],
      properties: {
        status: { type: "string", enum: ["connected"] },
        server: { type: "string" },
        readOnly: { type: "boolean" }
      },
      additionalProperties: false
    },
    annotations: readOnlyToolAnnotations
  },
  {
    name: "show_launcher",
    title: "\u6253\u5F00 Narracut \u9879\u76EE\u542F\u52A8\u5668",
    description: "\u5728\u6CA1\u6709\u9879\u76EE\u53C2\u6570\u65F6\u6253\u5F00 Narracut \u542F\u52A8\u5668\uFF0C\u7528\u7CFB\u7EDF\u6587\u4EF6\u5939\u9009\u62E9\u7A97\u53E3\u521B\u5EFA\u6216\u6253\u5F00 Project VNext\u3002",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } }
  },
  {
    name: "create_project",
    title: "\u539F\u5B50\u521B\u5EFA\u5E76\u6253\u5F00 Narracut \u9879\u76EE",
    description: "\u5728\u7528\u6237\u660E\u786E\u9009\u62E9\u7684\u4E0D\u5B58\u5728\u7EDD\u5BF9\u8DEF\u5F84\u540C\u7EA7\u751F\u6210 Project VNext\uFF0C\u5B8C\u6574\u6821\u9A8C\u540E\u539F\u5B50\u53D1\u5E03\u5E76\u53D6\u5F97\u5199\u5165\u79DF\u7EA6\u3002\u4E0D\u4F1A\u8054\u7F51\u3001\u5B89\u88C5\u4F9D\u8D56\u6216\u8986\u76D6\u5DF2\u6709\u76EE\u5F55\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        confirmTemporaryCleanup: { type: "boolean" }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } }
  },
  {
    name: "open_project",
    title: "\u6253\u5F00 Narracut \u9879\u76EE",
    description: "\u4E25\u683C\u6821\u9A8C\u7528\u6237\u660E\u786E\u9009\u62E9\u7684 Project VNext \u7EDD\u5BF9\u76EE\u5F55\u5E76\u53D6\u5F97\u72EC\u5360\u5199\u5165\u79DF\u7EA6\uFF1B\u4E0D\u4F1A\u521B\u5EFA\u3001\u8865\u5168\u3001\u8FC1\u79FB\u6216\u6539\u5199\u666E\u901A\u76EE\u5F55\u4E0E\u635F\u574F\u9879\u76EE\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: { projectDirectory: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } }
  },
  {
    name: "save_project_scenes",
    title: "\u4FDD\u5B58\u8868\u683C\u5DE5\u4F5C\u533A Scene",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u6309\u9879\u76EE\u8EAB\u4EFD\u4E0E\u78C1\u76D8\u57FA\u7EBF\u539F\u5B50\u4FDD\u5B58\u4E25\u683C Scene DSL\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "project"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        project: { type: "object" }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "save_project_video_brief",
    title: "\u4FDD\u5B58 Video Brief",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u6309\u72EC\u7ACB Brief ETag \u539F\u5B50\u4FDD\u5B58\u5B8C\u6574 video.md\uFF0C\u4E0D\u8986\u76D6\u5916\u90E8\u53D8\u5316\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "content"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        content: { type: "string" }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "export_project_video_brief_local",
    title: "\u5BFC\u51FA Video Brief LOCAL",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u628A\u51B2\u7A81\u4E2D\u7684 Brief LOCAL \u5BFC\u51FA\u5230\u9879\u76EE\u5916\u7684\u65B0\u6587\u4EF6\uFF0C\u4E0D\u8986\u76D6\u5DF2\u6709\u6587\u4EF6\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "targetDirectory", "content"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        targetDirectory: { type: "string", minLength: 1 },
        content: { type: "string" }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "import_project_asset",
    title: "\u5BFC\u5165\u4E00\u4E2A\u9879\u76EE Asset",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u9010\u5B57\u8282\u590D\u5236\u4E00\u4E2A\u7CFB\u7EDF\u6587\u4EF6\u9009\u62E9\u5668\u8FD4\u56DE\u7684\u666E\u901A\u6587\u4EF6\uFF0C\u767B\u8BB0\u540E\u53EF\u7ED1\u5B9A\u539F\u76EE\u6807 Scene\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "sourcePath"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        sourcePath: { type: "string", minLength: 1 },
        targetSceneId: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "read_project_asset_preview",
    title: "\u8BFB\u53D6\u9879\u76EE Asset \u9884\u89C8",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u6309\u767B\u8BB0 ID \u53EA\u8BFB\u68C0\u67E5 Asset\uFF0C\u5E76\u4E3A\u53EF\u5B89\u5168\u5185\u8054\u7684\u5DF2\u77E5\u683C\u5F0F\u8FD4\u56DE\u9884\u89C8\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "assetId"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        assetId: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "save_project_tts_settings",
    title: "\u4FDD\u5B58\u9879\u76EE TTS \u914D\u7F6E",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u539F\u5B50\u4FDD\u5B58\u9879\u76EE TTS \u914D\u7F6E\uFF0C\u5E76\u5728\u786E\u8BA4\u540E\u79FB\u9664\u4E0D\u518D\u5339\u914D\u7684 Speech \u8BB0\u5F55\u3002API Key \u53EA\u4FDD\u7559\u5728\u5BBF\u4E3B\u4F1A\u8BDD\u5185\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "config", "credentialAction", "expectedAffectedSpeechCount"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        config: { type: "object" },
        credentialAction: { type: "string", enum: ["keep", "replace", "clear"] },
        apiKey: { type: "string", minLength: 1 },
        expectedAffectedSpeechCount: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "start_scene_speech",
    title: "\u751F\u6210\u5F53\u524D Scene Speech",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u4E3A\u5F53\u524D Narration \u548C\u9879\u76EE TTS \u914D\u7F6E\u751F\u6210\u3001\u6821\u9A8C\u5E76\u539F\u5B50\u5E94\u7528 Speech\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "sceneId"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        sceneId: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "get_scene_speech_job",
    title: "\u8BFB\u53D6 Speech \u751F\u6210\u72B6\u6001",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u8BFB\u53D6\u4E00\u6B21 Scene Speech \u751F\u6210\u4EFB\u52A1\u7684\u6709\u754C\u72B6\u6001\u3002",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: { jobId: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "cancel_scene_speech_job",
    title: "\u53D6\u6D88 Speech \u751F\u6210",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u53D6\u6D88\u5F53\u524D Scene \u7684 Speech \u751F\u6210\uFF0C\u4E0D\u6539\u53D8\u65E2\u6709 Speech\u3002",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: { jobId: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, idempotentHint: true },
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "inspect_project",
    title: "\u68C0\u67E5 Narracut \u9879\u76EE",
    description: "\u53EA\u8BFB\u68C0\u67E5\u7528\u6237\u660E\u786E\u7ED9\u51FA\u7684 Project VNext \u7EDD\u5BF9\u76EE\u5F55\uFF0C\u8FD4\u56DE\u9879\u76EE\u8EAB\u4EFD\u3001Scene \u4E0E\u56FA\u5B9A\u63A7\u5236\u6587\u4EF6\u72B6\u6001\uFF0C\u5E76\u6253\u5F00\u5DE5\u4F5C\u53F0\u3002\u4E0D\u4F1A\u6D4F\u89C8\u5176\u4ED6\u76EE\u5F55\u3001\u5199\u6587\u4EF6\u3001\u6267\u884C Shell \u6216\u8BBF\u95EE\u7F51\u7EDC\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: {
        projectDirectory: {
          type: "string",
          minLength: 1,
          description: "\u7528\u6237\u660E\u786E\u6307\u5B9A\u7684 Project VNext \u7EDD\u5BF9\u76EE\u5F55\u3002"
        }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } }
  },
  {
    name: "start_agent_host_validation",
    title: "\u5F00\u59CB Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1",
    description: "\u4E3A\u7528\u6237\u660E\u786E\u7ED9\u51FA\u7684 Project VNext \u76EE\u5F55\u521B\u5EFA\u4E13\u7528 Codex \u521B\u4F5C\u7EBF\u7A0B\uFF0C\u5E76\u8FD0\u884C\u56FA\u5B9A\u7684\u53EA\u8BFB\u5BBF\u4E3B\u9A8C\u8BC1\u4EFB\u52A1\u3002\u4E0D\u4F1A\u4FEE\u6539\u9879\u76EE\u5185\u5BB9\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations
  },
  {
    name: "get_agent_host_validation",
    title: "\u8BFB\u53D6 Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1\u72B6\u6001",
    description: "\u53EA\u8BFB\u8FD4\u56DE\u4E00\u6B21\u4E34\u65F6\u5BBF\u4E3B\u9A8C\u8BC1\u4EFB\u52A1\u7684\u5F53\u524D\u7A33\u5B9A\u72B6\u6001\u3002",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations
  },
  {
    name: "stop_agent_host_validation",
    title: "\u505C\u6B62 Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1",
    description: "\u64A4\u9500\u5F53\u524D Codex \u521B\u4F5C\u7EBF\u7A0B\u7684\u9A71\u52A8\u6743\u5E76\u505C\u6B62\u9A8C\u8BC1 Turn\uFF0C\u4FDD\u7559\u6700\u5C0F\u53EF\u7EE7\u7EED\u68C0\u67E5\u70B9\u3002",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, idempotentHint: true }
  },
  {
    name: "continue_agent_host_validation",
    title: "\u7EE7\u7EED Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1",
    description: "\u6062\u590D\u53EF\u7528\u7684\u539F Codex \u521B\u4F5C\u7EBF\u7A0B\uFF1B\u7EBF\u7A0B\u5DF2\u5931\u6548\u65F6\u81EA\u52A8\u521B\u5EFA\u66FF\u4EE3\u7EBF\u7A0B\u5E76\u91CD\u65B0\u9A8C\u8BC1\u3002",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations
  }
];
function connectedState(readOnly = true) {
  return { status: "connected", readOnly };
}
function launcherConnectionState() {
  return { status: "connected", readOnly: false };
}
function serializeInspection(inspection, writable = false, credential = { status: "missing", storage: "session" }) {
  const assets = new Map(inspection.project.assets.map((asset) => [asset.id, asset]));
  const speechStates = new Map(inspection.speechStates.map((state) => [state.sceneId, state]));
  const timeWindows = new Map(inspection.timeline.scenes.map((time) => [time.sceneId, time]));
  return {
    status: "valid",
    connection: connectedState(!writable),
    writable,
    projectRevision: inspection.projectRevision,
    videoBrief: {
      content: inspection.videoBrief,
      revision: inspection.videoBriefRevision,
      bytes: Buffer.byteLength(inspection.videoBrief, "utf8"),
      state: inspection.videoBrief.length === 0 ? "empty" : "saved"
    },
    ...inspection.currentRenderProgram === void 0 ? {} : { currentRenderProgram: inspection.currentRenderProgram },
    projectDsl: inspection.project,
    tts: {
      ...inspection.tts,
      credential,
      capabilities: TTS_CAPABILITIES
    },
    speechStates: inspection.speechStates,
    timeline: inspection.timeline,
    project: {
      directory: inspection.projectDirectory,
      folderName: basename3(inspection.projectDirectory),
      projectId: inspection.manifest.projectId,
      sceneCount: inspection.project.scenes.length,
      assetCount: inspection.project.assets.length
    },
    checks: {
      manifest: { status: "valid", label: "\u9879\u76EE\u6E05\u5355" },
      dsl: { status: "valid", label: "Project DSL" },
      videoBrief: {
        status: "valid",
        label: "video.md",
        bytes: Buffer.byteLength(inspection.videoBrief, "utf8")
      }
    },
    scenes: inspection.project.scenes.map((scene, index) => ({
      id: scene.id,
      index: index + 1,
      narration: scene.narration.text,
      assets: scene.assetIds.map((assetId) => ({
        id: assetId,
        path: assets.get(assetId)?.path ?? null
      })),
      speech: speechStates.get(scene.id) ?? { status: "missing" },
      time: timeWindows.get(scene.id)
    })),
    warnings: inspection.warnings,
    assetStates: inspection.assetStates
  };
}
function diagnosticSummary(diagnostics) {
  return diagnostics.map(({ code, component, message, metric, actual, limit, jsonPath }) => ({
    code,
    component,
    message,
    ...metric === void 0 ? {} : { metric },
    ...actual === void 0 ? {} : { actual },
    ...limit === void 0 ? {} : { limit },
    ...jsonPath === void 0 ? {} : { jsonPath }
  }));
}
async function loadWorkbench() {
  const [html, script, paperTexture, filmTexture, displayFont, previewScript] = await Promise.all([
    readFile6(WORKBENCH_PATH, "utf8"),
    readFile6(WORKBENCH_SCRIPT_PATH, "utf8"),
    readFile6(PAPER_TEXTURE_PATH),
    readFile6(FILM_TEXTURE_PATH),
    readFile6(DISPLAY_FONT_PATH),
    readFile6(new URL(import.meta.url.endsWith("/server.mjs") ? "./workbench-preview.js" : "../workbench-preview.js", import.meta.url), "utf8")
  ]);
  const materialVariables = `@font-face{font-family:"Narracut Display";src:url("data:font/woff2;base64,${displayFont.toString("base64")}") format("woff2");font-style:normal;font-weight:100 800;font-stretch:75% 100%;font-display:block}:root{--paper-texture:url("data:image/webp;base64,${paperTexture.toString("base64")}");--film-texture:url("data:image/webp;base64,${filmTexture.toString("base64")}")}`;
  return html.replace("/*__NARRACUT_MATERIALS__*/", materialVariables).replace("/*__NARRACUT_WORKBENCH_JS__*/", previewScript + "\n" + script);
}
async function inspectProject(argumentsValue) {
  if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue) || typeof argumentsValue.projectDirectory !== "string") {
    return {
      isError: true,
      structuredContent: {
        status: "invalid",
        connection: connectedState(),
        error: { code: "INVALID_TOOL_INPUT", message: "projectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }
      },
      content: [{ type: "text", text: "\u65E0\u6CD5\u68C0\u67E5\u9879\u76EE\uFF1AprojectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }]
    };
  }
  const projectDirectory = argumentsValue.projectDirectory;
  if (!isAbsolute4(projectDirectory)) {
    return {
      isError: true,
      structuredContent: {
        status: "invalid",
        connection: connectedState(),
        error: { code: "INVALID_TOOL_INPUT", message: "\u53EA\u63A5\u53D7\u7528\u6237\u660E\u786E\u7ED9\u51FA\u7684\u7EDD\u5BF9\u9879\u76EE\u76EE\u5F55\u3002" }
      },
      content: [{ type: "text", text: "\u65E0\u6CD5\u68C0\u67E5\u9879\u76EE\uFF1A\u53EA\u63A5\u53D7\u7EDD\u5BF9\u9879\u76EE\u76EE\u5F55\u3002" }]
    };
  }
  try {
    const inspection = await inspectProjectVNext(projectDirectory);
    const structuredContent = serializeInspection(inspection);
    return {
      structuredContent,
      content: [{
        type: "text",
        text: `${basename3(inspection.projectDirectory)} \u662F\u6709\u6548\u7684 Project VNext\uFF0C\u5171 ${inspection.project.scenes.length} \u4E2A Scene\u3002\u5F53\u524D\u63D2\u4EF6\u53EA\u63D0\u4F9B\u53EA\u8BFB\u68C0\u67E5\u3002`
      }]
    };
  } catch (error) {
    if (error instanceof ProjectInspectionError) {
      return {
        isError: true,
        structuredContent: {
          status: "invalid",
          connection: connectedState(),
          project: { directory: projectDirectory, folderName: basename3(projectDirectory) },
          error: {
            code: error.code,
            path: error.path,
            message: error.message,
            diagnostics: diagnosticSummary(error.diagnostics)
          }
        },
        content: [{ type: "text", text: `Narracut \u9879\u76EE\u68C0\u67E5\u5931\u8D25\uFF1A${error.message}` }]
      };
    }
    throw error;
  }
}
function stringArgument(argumentsValue, name) {
  if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
    return null;
  }
  const value = argumentsValue[name];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
function hostValidationResult(hostValidation, text) {
  return {
    structuredContent: { hostValidation },
    content: [{ type: "text", text }]
  };
}
var SpeechToolError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "SpeechToolError";
  }
  code;
};
function publicSpeechJob(job) {
  const {
    projectId: _projectId,
    projectDirectory: _projectDirectory,
    narrationText: _narrationText,
    config: _config,
    ttsProfileId: _ttsProfileId,
    credential: _credential,
    controller: _controller,
    inspection: _inspection,
    commitPointReached: _commitPointReached,
    ...value
  } = job;
  return structuredClone(value);
}
function credentialState(value) {
  if (value === void 0) return { status: "missing", storage: "session" };
  return { status: "available", storage: "session", masked: `\u2022\u2022\u2022\u2022${value.slice(-4)}` };
}
var ProjectWorkspaceSession = class {
  preview = new ProjectPreview();
  async previewOperation(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    if (input.action === "status") return this.preview.status(opened, input.instanceId);
    if (input.action === "release") {
      this.preview.release(input.instanceId);
      return {};
    }
    if (input.action !== "build" || !["current", "candidate"].includes(input.target) || typeof input.parentOrigin !== "string") throw new Error("Preview \u53C2\u6570\u65E0\u6548\u3002");
    const preview = await this.preview.build(opened, input.target, input.parentOrigin);
    if (this.#opened !== opened) {
      this.preview.release(preview.instanceId);
      throw new Error("\u6784\u5EFA\u6240\u5C5E\u9879\u76EE\u5DF2\u5173\u95ED\uFF0C\u7ED3\u679C\u5DF2\u4E22\u5F03\u3002");
    }
    return { preview };
  }
  #opened = null;
  #credentials = /* @__PURE__ */ new Map();
  #speechJobs = /* @__PURE__ */ new Map();
  #ttsFetch;
  #probeSpeechDurationMs;
  constructor(options = {}) {
    this.#ttsFetch = options.ttsFetch ?? globalThis.fetch;
    this.#probeSpeechDurationMs = options.probeSpeechDurationMs ?? probeSpeechDurationMs;
  }
  credential(projectId) {
    return credentialState(this.#credentials.get(projectId));
  }
  #candidateStatus = null;
  serialize(inspection, writable = true) {
    return { ...serializeInspection(inspection, writable, this.credential(inspection.manifest.projectId)), candidate: this.#candidateStatus };
  }
  async open(projectDirectory) {
    const next = await openProjectVNext(projectDirectory, {
      probeSpeechDurationMs: this.#probeSpeechDurationMs
    });
    const previous = this.#opened;
    try {
      if (previous !== null) await previous.release();
    } catch (error) {
      await next.release();
      throw error;
    }
    this.preview.clear();
    this.#opened = next;
    this.#candidateStatus = await next.candidate({ action: "read" });
    return next.inspection;
  }
  async candidate(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    const { projectDirectory: _directory, projectId: _id, ...request } = input;
    this.#candidateStatus = await opened.candidate(request);
    return this.#candidateStatus;
  }
  async save(input) {
    const opened = this.#opened;
    if (opened === null || opened.inspection.projectDirectory !== input.projectDirectory || opened.inspection.manifest.projectId !== input.projectId) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        input.projectDirectory,
        "\u5F53\u524D\u5DE5\u4F5C\u53F0\u6CA1\u6709\u6301\u6709\u8BE5\u9879\u76EE\u7684\u5199\u5165\u79DF\u7EA6\uFF1BNarracut \u62D2\u7EDD\u4FDD\u5B58\u3002"
      );
    }
    const saved = await opened.saveProject(input.project, input.baselineRevision);
    opened.inspection = saved.inspection;
    return saved.inspection;
  }
  async saveVideoBrief(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    const saved = await opened.saveVideoBrief(input.content, input.baselineRevision);
    if (saved.status === "saved") opened.inspection = saved.inspection;
    return saved;
  }
  async exportVideoBriefLocal(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    return opened.exportVideoBriefLocal(input.content, input.targetDirectory);
  }
  async importAsset(input) {
    const opened = this.#opened;
    if (opened === null || opened.inspection.projectDirectory !== input.projectDirectory || opened.inspection.manifest.projectId !== input.projectId) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        input.projectDirectory,
        "\u5F53\u524D\u5DE5\u4F5C\u53F0\u6CA1\u6709\u6301\u6709\u8BE5\u9879\u76EE\u7684\u5199\u5165\u79DF\u7EA6\uFF1BNarracut \u62D2\u7EDD\u5BFC\u5165\u3002"
      );
    }
    const imported = await opened.importAsset({
      sourcePath: input.sourcePath,
      targetSceneId: input.targetSceneId,
      baselineRevision: input.baselineRevision
    });
    opened.inspection = imported.inspection;
    return imported;
  }
  async readAssetPreview(input) {
    const opened = this.#opened;
    if (opened === null || opened.inspection.projectDirectory !== input.projectDirectory || opened.inspection.manifest.projectId !== input.projectId) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        input.projectDirectory,
        "\u5F53\u524D\u5DE5\u4F5C\u53F0\u672A\u6301\u6709\u8BE5\u9879\u76EE\u8EAB\u4EFD\uFF1BNarracut \u62D2\u7EDD\u8BFB\u53D6\u9884\u89C8\u3002"
      );
    }
    return readProjectAssetPreview(opened.inspection, input.assetId);
  }
  async saveTtsSettings(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    if (input.credentialAction === "replace" && (input.apiKey === void 0 || input.apiKey.trim() === "")) {
      throw new SpeechToolError("TTS_CREDENTIAL_INVALID", "\u66FF\u6362 API Key \u65F6\u5FC5\u987B\u63D0\u4F9B\u975E\u7A7A\u503C\u3002");
    }
    const saved = await opened.saveTtsSettings({
      config: input.config,
      baselineRevision: input.baselineRevision,
      expectedAffectedSpeechCount: input.expectedAffectedSpeechCount
    });
    if (input.credentialAction === "replace") this.#credentials.set(input.projectId, input.apiKey);
    if (input.credentialAction === "clear") this.#credentials.delete(input.projectId);
    opened.inspection = saved.inspection;
    for (const job of this.#speechJobs.values()) {
      if (job.projectId === input.projectId && !["succeeded", "cancelled", "failed", "rejected"].includes(job.status) && saved.inspection.tts.status === "configured" && job.ttsProfileId !== saved.inspection.tts.profileId) {
        this.cancelSpeech(job.id, "TTS \u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u65E7\u914D\u7F6E\u751F\u6210\u4EFB\u52A1\u5DF2\u53D6\u6D88\u3002");
      }
    }
    return saved;
  }
  startSpeech(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    const tts = opened.inspection.tts;
    if (tts.status !== "configured") {
      throw new SpeechToolError("TTS_CONFIG_MISSING", "\u8BF7\u5148\u4FDD\u5B58\u9879\u76EE TTS \u914D\u7F6E\u3002");
    }
    const key = this.#credentials.get(input.projectId);
    if (key === void 0) {
      throw new SpeechToolError("TTS_CREDENTIAL_MISSING", "\u8BF7\u5148\u5F55\u5165 TokenDance API Key\uFF1B\u51ED\u636E\u53EA\u4FDD\u7559\u5728\u5F53\u524D\u5BBF\u4E3B\u4F1A\u8BDD\u3002");
    }
    const scene = opened.inspection.project.scenes.find((candidate) => candidate.id === input.sceneId);
    if (scene === void 0) throw new SpeechToolError("SPEECH_SCENE_MISSING", "\u76EE\u6807 Scene \u4E0D\u5B58\u5728\u3002");
    if (scene.narration.text.trim() === "") {
      throw new SpeechToolError("SPEECH_NARRATION_EMPTY", "\u7A7A Narration \u4E0D\u80FD\u751F\u6210 Speech\uFF1B\u8BF7\u5148\u8865\u5145\u5185\u5BB9\u3002");
    }
    if ([...this.#speechJobs.values()].some((job2) => job2.projectId === input.projectId && job2.sceneId === input.sceneId && !["succeeded", "cancelled", "failed", "rejected"].includes(job2.status))) {
      throw new SpeechToolError("SPEECH_JOB_ACTIVE", "\u5F53\u524D Scene \u5DF2\u6709 Speech \u6B63\u5728\u751F\u6210\u3002");
    }
    if (this.#speechJobs.size >= 128) {
      const terminal = [...this.#speechJobs.values()].filter((job2) => ["succeeded", "cancelled", "failed", "rejected"].includes(job2.status)).sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
      for (const job2 of terminal.slice(0, Math.max(1, this.#speechJobs.size - 127))) {
        this.#speechJobs.delete(job2.id);
      }
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const job = {
      id: randomUUID7(),
      sceneId: scene.id,
      status: "queued",
      stage: "\u6392\u961F",
      createdAt: now,
      updatedAt: now,
      projectId: input.projectId,
      projectDirectory: input.projectDirectory,
      narrationText: scene.narration.text,
      config: structuredClone(tts.config),
      ttsProfileId: tts.profileId,
      credential: key
    };
    this.#speechJobs.set(job.id, job);
    setImmediate(() => void this.#processSpeech(job));
    return publicSpeechJob(job);
  }
  getSpeech(jobId) {
    const job = this.#speechJobs.get(jobId);
    if (job === void 0) throw new SpeechToolError("SPEECH_JOB_NOT_FOUND", "Speech \u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u5931\u6548\u3002");
    const result = { job: publicSpeechJob(job), ...job.inspection === void 0 ? {} : { inspection: job.inspection } };
    return result;
  }
  cancelSpeech(jobId, message = "Speech \u751F\u6210\u5DF2\u53D6\u6D88\uFF1B\u65E2\u6709 Speech \u4FDD\u6301\u4E0D\u53D8\u3002") {
    const job = this.#speechJobs.get(jobId);
    if (job === void 0) throw new SpeechToolError("SPEECH_JOB_NOT_FOUND", "Speech \u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u5931\u6548\u3002");
    if (!["succeeded", "cancelled", "failed", "rejected"].includes(job.status) && !job.commitPointReached) {
      job.status = "cancelled";
      job.stage = "\u5DF2\u53D6\u6D88";
      job.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      job.error = { code: "SPEECH_CANCELLED", message, retryable: true };
      job.controller?.abort();
    }
    return publicSpeechJob(job);
  }
  #requireOpened(projectDirectory, projectId) {
    const opened = this.#opened;
    if (opened === null || opened.inspection.projectDirectory !== projectDirectory || opened.inspection.manifest.projectId !== projectId) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        projectDirectory,
        "\u5F53\u524D\u5DE5\u4F5C\u53F0\u672A\u6301\u6709\u8BE5\u9879\u76EE\u8EAB\u4EFD\uFF1BNarracut \u62D2\u7EDD\u64CD\u4F5C Speech\u3002"
      );
    }
    return opened;
  }
  #updateSpeech(job, status, stage) {
    if (job.status === "cancelled") return;
    job.status = status;
    job.stage = stage;
    job.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  async #processSpeech(job) {
    try {
      if (job.status === "cancelled") return;
      this.#updateSpeech(job, "generating", "\u6B63\u5728\u751F\u6210");
      const controller = new AbortController();
      job.controller = controller;
      const response = await this.#ttsFetch("https://tokendance.space/gateway/minimax/v1/t2a_v2", {
        method: "POST",
        headers: {
          authorization: `Bearer ${job.credential}`,
          "content-type": "application/json",
          "x-app-url": "app://narracut"
        },
        body: JSON.stringify({
          model: job.config.model,
          text: job.narrationText,
          stream: false,
          voice_setting: {
            voice_id: job.config.voice,
            speed: job.config.speed,
            vol: job.config.volume,
            pitch: job.config.pitch
          },
          audio_setting: {
            sample_rate: TTS_CAPABILITIES.audio.sampleRate,
            bitrate: TTS_CAPABILITIES.audio.bitrate,
            format: TTS_CAPABILITIES.audio.format,
            channel: TTS_CAPABILITIES.audio.channels
          }
        }),
        signal: controller.signal
      });
      if (job.status === "cancelled") return;
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new SpeechToolError("TTS_RESPONSE_INVALID", "Speech \u63D0\u4F9B\u65B9\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94\u7ED3\u6784\u3002");
      }
      if (!response.ok || typeof payload?.base_resp?.status_code === "number" && payload.base_resp.status_code !== 0) {
        const code = response.status === 401 || response.status === 403 ? "TTS_AUTH_FAILED" : response.status === 429 ? "TTS_RATE_LIMITED" : "TTS_PROVIDER_FAILED";
        throw new SpeechToolError(code, code === "TTS_AUTH_FAILED" ? "TokenDance \u9274\u6743\u5931\u8D25\uFF0C\u8BF7\u66FF\u6362 API Key\u3002" : code === "TTS_RATE_LIMITED" ? "TokenDance \u8BF7\u6C42\u8FC7\u591A\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" : "Speech \u63D0\u4F9B\u65B9\u62D2\u7EDD\u4E86\u672C\u6B21\u8BF7\u6C42\u3002");
      }
      const audioHex = payload?.data?.audio;
      const providerDurationMs = payload?.extra_info?.audio_length;
      if (typeof audioHex !== "string" || audioHex.length === 0 || audioHex.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(audioHex) || !Number.isSafeInteger(providerDurationMs) || providerDurationMs <= 0 || payload?.extra_info?.audio_format !== void 0 && payload.extra_info.audio_format !== "mp3") {
        throw new SpeechToolError("TTS_RESPONSE_INVALID", "Speech \u63D0\u4F9B\u65B9\u8FD4\u56DE\u4E86\u4E0D\u5B8C\u6574\u7684 MP3 \u6216\u65F6\u957F\u4FE1\u606F\u3002");
      }
      const audio = Buffer.from(audioHex, "hex");
      this.#updateSpeech(job, "validating", "\u6B63\u5728\u6821\u9A8C");
      let durationMs;
      try {
        const opened2 = this.#requireOpened(job.projectDirectory, job.projectId);
        durationMs = await opened2.probeSpeechAudio({ jobId: job.id, audio });
      } catch (cause) {
        if (cause instanceof ProjectLifecycleError) throw cause;
        throw new SpeechToolError("TTS_AUDIO_INVALID", "\u751F\u6210\u7684 Speech \u65E0\u6CD5\u5728\u672C\u673A\u89E3\u7801\u4E3A MP3\u3002");
      }
      if (Math.abs(durationMs - providerDurationMs) > 34) {
        throw new SpeechToolError("TTS_DURATION_MISMATCH", "Speech \u5B9E\u9645\u65F6\u957F\u4E0E\u63D0\u4F9B\u65B9\u8FD4\u56DE\u65F6\u957F\u4E0D\u4E00\u81F4\u3002");
      }
      if (job.status === "cancelled") return;
      this.#updateSpeech(job, "writing", "\u6B63\u5728\u5199\u5165");
      const opened = this.#requireOpened(job.projectDirectory, job.projectId);
      const committed = await opened.commitSpeech({
        sceneId: job.sceneId,
        narrationText: job.narrationText,
        ttsProfileId: job.ttsProfileId,
        durationMs,
        audio,
        isCancelled: () => job.status === "cancelled",
        onCommitPoint: () => {
          job.commitPointReached = true;
        }
      });
      opened.inspection = committed.inspection;
      job.inspection = committed.inspection;
      if (committed.status === "rejected") {
        this.#updateSpeech(job, "rejected", "\u7ED3\u679C\u672A\u5E94\u7528");
        job.error = { code: committed.code, message: committed.message, retryable: true };
        return;
      }
      this.#updateSpeech(job, "succeeded", "\u751F\u6210\u5B8C\u6210");
      job.result = { durationMs, message: committed.message };
    } catch (cause) {
      if (job.status === "cancelled" || cause instanceof Error && cause.name === "AbortError") return;
      this.#updateSpeech(job, "failed", "\u751F\u6210\u5931\u8D25");
      const code = cause instanceof SpeechToolError || cause instanceof ProjectLifecycleError ? cause.code : "SPEECH_GENERATION_FAILED";
      job.error = {
        code,
        message: cause instanceof Error ? cause.message : "Speech \u751F\u6210\u5931\u8D25\u3002",
        retryable: !["TTS_AUTH_FAILED", "TTS_RESPONSE_INVALID", "TTS_AUDIO_INVALID"].includes(code)
      };
    } finally {
      job.controller = void 0;
      job.credential = "";
      if (["succeeded", "cancelled", "failed", "rejected"].includes(job.status)) {
        const expiration = setTimeout(() => this.#speechJobs.delete(job.id), 5 * 6e4);
        expiration.unref();
      }
    }
  }
  async dispose() {
    for (const job of this.#speechJobs.values()) {
      if (!["succeeded", "cancelled", "failed", "rejected"].includes(job.status)) this.cancelSpeech(job.id);
    }
    await this.preview.close();
    this.#credentials.clear();
    this.#speechJobs.clear();
    const opened = this.#opened;
    this.#opened = null;
    if (opened !== null) await opened.release();
  }
};
function lifecycleFailure(error) {
  return {
    isError: true,
    structuredContent: {
      status: "invalid",
      connection: launcherConnectionState(),
      error: {
        code: error.code,
        path: error.path,
        message: error.message,
        ...error instanceof ProjectInspectionError ? { diagnostics: diagnosticSummary(error.diagnostics) } : {}
      }
    },
    content: [{ type: "text", text: `Narracut \u9879\u76EE\u64CD\u4F5C\u5931\u8D25\uFF1A${error.message}` }]
  };
}
async function callTool(params, hostValidation, workspace) {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("tools/call \u7F3A\u5C11\u53C2\u6570\u3002");
  }
  const { name, arguments: argumentsValue } = params;
  if (name === "project_preview") {
    try {
      return { structuredContent: await workspace.previewOperation(argumentsValue), content: [] };
    } catch (error) {
      return { isError: true, structuredContent: { error: { code: error.code ?? "PREVIEW_FAILED", message: error instanceof Error ? error.message : "Preview \u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002" } }, content: [] };
    }
  }
  if (name === "health_check") {
    return {
      structuredContent: { status: "connected", server: "narracut", readOnly: false },
      content: [{ type: "text", text: "Narracut \u63D2\u4EF6\u5DF2\u8FDE\u63A5\uFF1B\u53EF\u539F\u5B50\u521B\u5EFA\u3001\u4E25\u683C\u6253\u5F00 Project VNext\uFF0C\u5E76\u5728\u8868\u683C\u5DE5\u4F5C\u533A\u7F16\u8F91 Scene\u3002" }]
    };
  }
  if (name === "show_launcher") {
    return {
      structuredContent: { status: "launcher", connection: launcherConnectionState() },
      content: [{ type: "text", text: "Narracut \u9879\u76EE\u542F\u52A8\u5668\u5DF2\u6253\u5F00\uFF1B\u8BF7\u9009\u62E9\u7236\u76EE\u5F55\u521B\u5EFA\u9879\u76EE\uFF0C\u6216\u9009\u62E9\u73B0\u6709 Project VNext \u6253\u5F00\u3002" }]
    };
  }
  if (name === "create_project" || name === "open_project") {
    const projectDirectory = stringArgument(argumentsValue, "projectDirectory");
    if (projectDirectory === null || !isAbsolute4(projectDirectory)) {
      return {
        isError: true,
        structuredContent: {
          status: "invalid",
          connection: launcherConnectionState(),
          error: { code: "INVALID_TOOL_INPUT", message: "projectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u64CD\u4F5C\u9879\u76EE\uFF1AprojectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }]
      };
    }
    let createdProject = false;
    try {
      let operation;
      if (name === "create_project") {
        const confirmTemporaryCleanup = typeof argumentsValue === "object" && argumentsValue !== null && !Array.isArray(argumentsValue) && argumentsValue.confirmTemporaryCleanup === true;
        await createProjectVNext(projectDirectory, { confirmTemporaryCleanup });
        createdProject = true;
        operation = "created";
      } else {
        operation = "opened";
      }
      const inspection = await workspace.open(projectDirectory);
      return {
        structuredContent: { ...workspace.serialize(inspection), operation },
        content: [{
          type: "text",
          text: operation === "created" ? `${basename3(inspection.projectDirectory)} \u5DF2\u539F\u5B50\u521B\u5EFA\u5E76\u6253\u5F00\uFF0C\u5171 0 \u4E2A Scene\u3002` : `${basename3(inspection.projectDirectory)} \u5DF2\u4E25\u683C\u6821\u9A8C\u5E76\u6253\u5F00\u3002`
        }]
      };
    } catch (error) {
      if (createdProject) {
        const causeCode = error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError ? error.code : "PROJECT_OPEN_FAILED";
        return {
          isError: true,
          structuredContent: {
            status: "created-not-opened",
            connection: launcherConnectionState(),
            project: { directory: projectDirectory, folderName: basename3(projectDirectory) },
            error: {
              code: "PROJECT_CREATED_NOT_OPENED",
              causeCode,
              path: projectDirectory,
              message: "\u9879\u76EE\u5DF2\u7ECF\u5B8C\u6574\u521B\u5EFA\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u53D6\u5F97\u5DE5\u4F5C\u533A\u79DF\u7EA6\u3002\u8BF7\u4F7F\u7528\u201C\u6253\u5F00\u9879\u76EE\u201D\u91CD\u8BD5\uFF1B\u4E0D\u8981\u518D\u6B21\u521B\u5EFA\u3002"
            }
          },
          content: [{
            type: "text",
            text: `\u9879\u76EE\u5DF2\u7ECF\u521B\u5EFA\u5728 ${projectDirectory}\uFF0C\u4F46\u5C1A\u672A\u6253\u5F00\uFF08${causeCode}\uFF09\u3002`
          }]
        };
      }
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        return lifecycleFailure(error);
      }
      throw error;
    }
  }
  if (name === "coordinate_project_dependencies") {
    const input = argumentsValue;
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["projectDirectory", "projectId", "baseline", "dependencies", "packages"].includes(key)) || typeof input.projectDirectory !== "string" || !isAbsolute4(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.baseline !== "string") {
      return { isError: true, structuredContent: { status: "dependency-failed", error: { code: "DEPENDENCY_SOURCE_UNSUPPORTED", message: "\u4F9D\u8D56\u534F\u8C03\u53C2\u6570\u65E0\u6548\uFF1B\u4E0D\u63A5\u53D7\u81EA\u5B9A\u4E49\u6765\u6E90\u6216\u51ED\u636E\u3002" } }, content: [{ type: "text", text: "\u4F9D\u8D56\u534F\u8C03\u53C2\u6570\u65E0\u6548\uFF1B\u4E0D\u63A5\u53D7\u81EA\u5B9A\u4E49\u6765\u6E90\u6216\u51ED\u636E\u3002" }] };
    }
    try {
      const candidate = await workspace.candidate({ ...input, action: "dependencies" });
      return { structuredContent: { status: "candidate-state", candidate }, content: [{ type: "text", text: "\u5019\u9009\u7CBE\u786E\u4F9D\u8D56\u3001\u9501\u56FE\u4E0E\u79BB\u7EBF\u4F9D\u8D56\u5E93\u5DF2\u539F\u5B50\u4FDD\u5B58\uFF0C\u5C1A\u672A\u68C0\u67E5\u6216\u63A5\u53D7\u3002" }] };
    } catch (error) {
      const known = error instanceof DependencyError || error instanceof CandidateError || error instanceof ProjectLifecycleError;
      const code = known ? error.code : "DEPENDENCY_UNAVAILABLE";
      const message = known ? error.message : "\u4F9D\u8D56\u534F\u8C03\u5931\u8D25\uFF1B\u539F\u5019\u9009\u4E0E\u79BB\u7EBF\u5E93\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u663E\u5F0F\u91CD\u8BD5\u3002";
      return { isError: true, structuredContent: { status: "dependency-failed", error: { code, message } }, content: [{ type: "text", text: message }] };
    }
  }
  if (name === "manage_project_candidate") {
    const input = argumentsValue;
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.projectDirectory !== "string" || !isAbsolute4(input.projectDirectory) || typeof input.projectId !== "string" || !["read", "create", "apply", "discard"].includes(String(input.action)) || input.baseline !== void 0 && typeof input.baseline !== "string" || input.confirmed !== void 0 && typeof input.confirmed !== "boolean") {
      return { isError: true, structuredContent: { status: "candidate-failed", error: { code: "INVALID_TOOL_INPUT", message: "\u5019\u9009\u64CD\u4F5C\u53C2\u6570\u65E0\u6548\u3002" } }, content: [{ type: "text", text: "\u5019\u9009\u64CD\u4F5C\u53C2\u6570\u65E0\u6548\u3002" }] };
    }
    try {
      const candidate = await workspace.candidate(input);
      return { structuredContent: { status: "candidate-state", candidate }, content: [{ type: "text", text: candidate.error?.message ?? (candidate.status === "absent" ? "\u6CA1\u6709\u5019\u9009\uFF1B\u5F53\u524D\u4FEE\u8BA2\u4FDD\u7559\u3002" : "\u5019\u9009\u5DF2\u4FDD\u5B58\uFF0C\u5C1A\u672A\u68C0\u67E5\u3001\u5C1A\u672A\u63A5\u53D7\u3002") }] };
    } catch (error) {
      if (error instanceof CandidateError || error instanceof ProjectLifecycleError) {
        return { isError: true, structuredContent: { status: error.code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "candidate-failed", error: { code: error.code, message: error.message } }, content: [{ type: "text", text: error.message }] };
      }
      return { isError: true, structuredContent: { status: "candidate-failed", error: { code: "CANDIDATE_SAVE_FAILED", message: "\u5019\u9009\u64CD\u4F5C\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u539F\u5019\u9009\u3002" } }, content: [{ type: "text", text: "\u5019\u9009\u64CD\u4F5C\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u539F\u5019\u9009\u3002" }] };
    }
  }
  if (name === "save_project_scenes") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: {
          status: "save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u4FDD\u5B58\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 Scene\uFF1A\u4FDD\u5B58\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute4(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.baselineRevision !== "string" || !("project" in input)) {
      return {
        isError: true,
        structuredContent: {
          status: "save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u3001\u57FA\u7EBF\u6216 Project DSL \u65E0\u6548\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 Scene\uFF1A\u9879\u76EE\u8EAB\u4EFD\u3001\u57FA\u7EBF\u6216 Project DSL \u65E0\u6548\u3002" }]
      };
    }
    try {
      const inspection = await workspace.save({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        project: input.project
      });
      return {
        structuredContent: { ...workspace.serialize(inspection), status: "saved" },
        content: [{ type: "text", text: `\u5DF2\u539F\u5B50\u4FDD\u5B58 ${inspection.project.scenes.length} \u4E2A Scene\u3002` }]
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const status = error instanceof ProjectLifecycleError && error.code === "PROJECT_SAVE_CONFLICT" ? "save-conflict" : error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "save-failed";
        const failure2 = lifecycleFailure(error);
        return {
          ...failure2,
          structuredContent: {
            ...failure2.structuredContent,
            status,
            connection: connectedState(false)
          }
        };
      }
      throw error;
    }
  }
  if (name === "save_project_video_brief") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: {
          status: "brief-save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "Video Brief \u4FDD\u5B58\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 Video Brief\uFF1A\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute4(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.baselineRevision !== "string" || typeof input.content !== "string") {
      return {
        isError: true,
        structuredContent: {
          status: "brief-save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u3001Brief ETag \u6216 Markdown \u5185\u5BB9\u65E0\u6548\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 Video Brief\uFF1A\u9879\u76EE\u8EAB\u4EFD\u3001Brief ETag \u6216\u5185\u5BB9\u65E0\u6548\u3002" }]
      };
    }
    try {
      const saved = await workspace.saveVideoBrief({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        content: input.content
      });
      if (saved.status === "conflict") {
        return {
          structuredContent: { status: "brief-conflict", disk: saved.disk },
          content: [{ type: "text", text: "video.md \u5DF2\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u4FDD\u7559 BASE\u3001LOCAL \u4E0E DISK\uFF0C\u672A\u8986\u76D6\u78C1\u76D8\u5185\u5BB9\u3002" }]
        };
      }
      return {
        structuredContent: { ...workspace.serialize(saved.inspection), status: "brief-saved" },
        content: [{ type: "text", text: "\u5DF2\u6309 Brief ETag \u539F\u5B50\u4FDD\u5B58\u5B8C\u6574 video.md\u3002" }]
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const failure2 = lifecycleFailure(error);
        return {
          ...failure2,
          structuredContent: {
            ...failure2.structuredContent,
            status: error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "brief-save-failed"
          }
        };
      }
      throw error;
    }
  }
  if (name === "export_project_video_brief_local") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: {
          status: "brief-export-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "Video Brief LOCAL \u5BFC\u51FA\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5BFC\u51FA Video Brief LOCAL\uFF1A\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute4(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.targetDirectory !== "string" || !isAbsolute4(input.targetDirectory) || typeof input.content !== "string") {
      return {
        isError: true,
        structuredContent: {
          status: "brief-export-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u3001\u5BFC\u51FA\u76EE\u5F55\u6216 LOCAL \u5185\u5BB9\u65E0\u6548\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5BFC\u51FA Video Brief LOCAL\uFF1A\u9879\u76EE\u8EAB\u4EFD\u3001\u76EE\u5F55\u6216\u5185\u5BB9\u65E0\u6548\u3002" }]
      };
    }
    try {
      const exported = await workspace.exportVideoBriefLocal({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        targetDirectory: input.targetDirectory,
        content: input.content
      });
      return {
        structuredContent: { status: "brief-exported", exported },
        content: [{ type: "text", text: `Video Brief LOCAL \u5DF2\u5BFC\u51FA\u5230 ${exported.path}\uFF1B\u672A\u8986\u76D6\u5DF2\u6709\u6587\u4EF6\u3002` }]
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const failure2 = lifecycleFailure(error);
        return {
          ...failure2,
          structuredContent: { ...failure2.structuredContent, status: "brief-export-failed" }
        };
      }
      throw error;
    }
  }
  if (name === "import_project_asset") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: {
          status: "asset-import-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u5BFC\u5165\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5BFC\u5165 Asset\uFF1A\u5BFC\u5165\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute4(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.baselineRevision !== "string" || typeof input.sourcePath !== "string" || !isAbsolute4(input.sourcePath) || input.targetSceneId !== void 0 && typeof input.targetSceneId !== "string") {
      return {
        isError: true,
        structuredContent: {
          status: "asset-import-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u3001\u57FA\u7EBF\u6216\u5BFC\u5165\u6E90\u65E0\u6548\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5BFC\u5165 Asset\uFF1A\u9879\u76EE\u8EAB\u4EFD\u3001\u57FA\u7EBF\u6216\u5BFC\u5165\u6E90\u65E0\u6548\u3002" }]
      };
    }
    try {
      const imported = await workspace.importAsset({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        sourcePath: input.sourcePath,
        ...typeof input.targetSceneId === "string" ? { targetSceneId: input.targetSceneId } : {}
      });
      const { inspection, ...assetImport } = imported;
      return {
        structuredContent: {
          ...workspace.serialize(inspection),
          status: imported.status.startsWith("imported-") ? "asset-imported" : "asset-import-result",
          assetImport
        },
        content: [{ type: "text", text: imported.message }]
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const failure2 = lifecycleFailure(error);
        return {
          ...failure2,
          structuredContent: {
            ...failure2.structuredContent,
            status: error instanceof ProjectLifecycleError && error.code === "PROJECT_SAVE_CONFLICT" ? "save-conflict" : error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "asset-import-failed",
            connection: connectedState(false)
          }
        };
      }
      throw error;
    }
  }
  if (name === "read_project_asset_preview") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: { assetPreview: { status: "dangling", id: "", reason: "\u9884\u89C8\u53C2\u6570\u65E0\u6548\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u8BFB\u53D6 Asset \u9884\u89C8\uFF1A\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute4(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.assetId !== "string") {
      return {
        isError: true,
        structuredContent: { assetPreview: { status: "dangling", id: "", reason: "\u9879\u76EE\u8EAB\u4EFD\u6216 Asset ID \u65E0\u6548\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u8BFB\u53D6 Asset \u9884\u89C8\uFF1A\u9879\u76EE\u8EAB\u4EFD\u6216 Asset ID \u65E0\u6548\u3002" }]
      };
    }
    try {
      const assetPreview = await workspace.readAssetPreview({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        assetId: input.assetId
      });
      return {
        structuredContent: { assetPreview },
        content: [{
          type: "text",
          text: assetPreview.status === "available" ? `${assetPreview.filename} \u5DF2\u5B8C\u6210\u53EA\u8BFB\u68C0\u67E5\u3002` : assetPreview.reason
        }]
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST") {
        return {
          isError: true,
          structuredContent: {
            status: "identity-lost",
            error: { code: error.code, path: error.path, message: error.message }
          },
          content: [{ type: "text", text: `\u65E0\u6CD5\u8BFB\u53D6 Asset \u9884\u89C8\uFF1A${error.message}` }]
        };
      }
      throw error;
    }
  }
  if (name === "save_project_tts_settings") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: { status: "tts-save-failed", error: { code: "INVALID_TOOL_INPUT", message: "TTS \u4FDD\u5B58\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 TTS \u914D\u7F6E\uFF1A\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute4(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.baselineRevision !== "string" || typeof input.config !== "object" || input.config === null || !["keep", "replace", "clear"].includes(String(input.credentialAction)) || !Number.isSafeInteger(input.expectedAffectedSpeechCount) || Number(input.expectedAffectedSpeechCount) < 0 || input.apiKey !== void 0 && typeof input.apiKey !== "string") {
      return {
        isError: true,
        structuredContent: { status: "tts-save-failed", error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u3001\u914D\u7F6E\u6216\u51ED\u636E\u64CD\u4F5C\u65E0\u6548\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 TTS \u914D\u7F6E\uFF1A\u9879\u76EE\u8EAB\u4EFD\u3001\u914D\u7F6E\u6216\u51ED\u636E\u64CD\u4F5C\u65E0\u6548\u3002" }]
      };
    }
    try {
      const saved = await workspace.saveTtsSettings({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        config: input.config,
        credentialAction: input.credentialAction,
        expectedAffectedSpeechCount: input.expectedAffectedSpeechCount,
        ...typeof input.apiKey === "string" ? { apiKey: input.apiKey } : {}
      });
      return {
        structuredContent: {
          ...workspace.serialize(saved.inspection),
          status: "tts-saved",
          affectedSpeechCount: saved.affectedSpeechCount
        },
        content: [{ type: "text", text: saved.affectedSpeechCount > 0 ? `TTS \u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u5E76\u79FB\u9664 ${saved.affectedSpeechCount} \u6761\u4E0D\u518D\u5339\u914D\u7684 Speech \u8BB0\u5F55\u3002` : "TTS \u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF1B\u73B0\u6709 Speech \u4ECD\u4E0E\u914D\u7F6E\u5339\u914D\u3002" }]
      };
    } catch (error) {
      if (error instanceof ProjectTtsConfirmationError) {
        return {
          isError: true,
          structuredContent: {
            status: "tts-confirmation-required",
            affectedSpeechCount: error.affectedSpeechCount,
            error: { code: error.code, message: error.message }
          },
          content: [{ type: "text", text: error.message }]
        };
      }
      const code = error instanceof SpeechToolError ? error.code : error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError ? error.code : "TTS_SAVE_FAILED";
      return {
        isError: true,
        structuredContent: {
          status: code === "PROJECT_SAVE_CONFLICT" ? "save-conflict" : code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "tts-save-failed",
          error: { code, message: error instanceof Error ? error.message : "\u65E0\u6CD5\u4FDD\u5B58 TTS \u914D\u7F6E\u3002" }
        },
        content: [{ type: "text", text: `\u65E0\u6CD5\u4FDD\u5B58 TTS \u914D\u7F6E\uFF1A${error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF"}` }]
      };
    }
  }
  if (name === "start_scene_speech") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: { status: "speech-start-failed", error: { code: "INVALID_TOOL_INPUT", message: "Speech \u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5F00\u59CB Speech \u751F\u6210\uFF1A\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute4(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.sceneId !== "string") {
      return {
        isError: true,
        structuredContent: { status: "speech-start-failed", error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u6216 Scene ID \u65E0\u6548\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5F00\u59CB Speech \u751F\u6210\uFF1A\u9879\u76EE\u8EAB\u4EFD\u6216 Scene ID \u65E0\u6548\u3002" }]
      };
    }
    try {
      const speechJob = workspace.startSpeech({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        sceneId: input.sceneId
      });
      return {
        structuredContent: { status: "speech-started", speechJob },
        content: [{ type: "text", text: "Speech \u751F\u6210\u5DF2\u6392\u961F\u3002" }]
      };
    } catch (error) {
      const code = error instanceof SpeechToolError ? error.code : error instanceof ProjectLifecycleError ? error.code : "SPEECH_START_FAILED";
      return {
        isError: true,
        structuredContent: { status: "speech-start-failed", error: { code, message: error instanceof Error ? error.message : "\u65E0\u6CD5\u5F00\u59CB Speech \u751F\u6210\u3002" } },
        content: [{ type: "text", text: `\u65E0\u6CD5\u5F00\u59CB Speech \u751F\u6210\uFF1A${error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF"}` }]
      };
    }
  }
  if (name === "get_scene_speech_job" || name === "cancel_scene_speech_job") {
    const jobId = stringArgument(argumentsValue, "jobId");
    if (jobId === null) {
      return {
        isError: true,
        structuredContent: { status: "speech-job-failed", error: { code: "INVALID_TOOL_INPUT", message: "jobId \u4E0D\u80FD\u4E3A\u7A7A\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u8BFB\u53D6 Speech \u4EFB\u52A1\uFF1AjobId \u4E0D\u80FD\u4E3A\u7A7A\u3002" }]
      };
    }
    try {
      if (name === "cancel_scene_speech_job") {
        const speechJob = workspace.cancelSpeech(jobId);
        const cancelled = speechJob.status === "cancelled";
        return {
          structuredContent: { status: cancelled ? "speech-cancelled" : "speech-commit-in-progress", speechJob },
          content: [{ type: "text", text: cancelled ? "Speech \u751F\u6210\u5DF2\u53D6\u6D88\uFF1B\u65E2\u6709 Speech \u4FDD\u6301\u4E0D\u53D8\u3002" : "Speech \u5DF2\u8D8A\u8FC7\u63D0\u4EA4\u70B9\uFF0C\u65E0\u6CD5\u53D6\u6D88\uFF1BNarracut \u5C06\u5B8C\u6210\u5F53\u524D\u539F\u5B50\u63D0\u4EA4\u3002" }]
        };
      }
      const current = workspace.getSpeech(jobId);
      return {
        structuredContent: {
          status: "speech-job",
          speechJob: current.job,
          ...current.inspection === void 0 ? {} : workspace.serialize(current.inspection)
        },
        content: [{ type: "text", text: `Speech \u4EFB\u52A1\u72B6\u6001\uFF1A${current.job.status}\u3002` }]
      };
    } catch (error) {
      return {
        isError: true,
        structuredContent: { status: "speech-job-failed", error: { code: error instanceof SpeechToolError ? error.code : "SPEECH_JOB_FAILED", message: error instanceof Error ? error.message : "\u65E0\u6CD5\u8BFB\u53D6 Speech \u4EFB\u52A1\u3002" } },
        content: [{ type: "text", text: `\u65E0\u6CD5\u8BFB\u53D6 Speech \u4EFB\u52A1\uFF1A${error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF"}` }]
      };
    }
  }
  if (name === "inspect_project") return inspectProject(argumentsValue);
  if (name === "start_agent_host_validation") {
    const projectDirectory = stringArgument(argumentsValue, "projectDirectory");
    if (projectDirectory === null || !isAbsolute4(projectDirectory)) {
      return {
        isError: true,
        structuredContent: {
          error: { code: "INVALID_TOOL_INPUT", message: "projectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5F00\u59CB\u5BBF\u4E3B\u9A8C\u8BC1\uFF1AprojectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }]
      };
    }
    try {
      const inspection = await inspectProjectVNext(projectDirectory);
      const state = await hostValidation.start({
        projectDirectory: inspection.projectDirectory,
        projectId: inspection.manifest.projectId,
        sceneCount: inspection.project.scenes.length
      });
      return hostValidationResult(
        state,
        state.status === "running" ? "Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1\u5DF2\u5F00\u59CB\uFF1B\u9879\u76EE\u4FDD\u6301\u53EA\u8BFB\u3002" : "Codex \u5BBF\u4E3B\u5F53\u524D\u4E0D\u53EF\u7528\uFF1B\u9A8C\u8BC1\u5DF2\u505C\u6B62\uFF0C\u53EF\u7A0D\u540E\u7EE7\u7EED\u3002"
      );
    } catch (error) {
      if (error instanceof ProjectInspectionError) {
        return {
          isError: true,
          structuredContent: {
            error: { code: error.code, message: error.message }
          },
          content: [{ type: "text", text: `\u65E0\u6CD5\u5F00\u59CB\u5BBF\u4E3B\u9A8C\u8BC1\uFF1A${error.message}` }]
        };
      }
      throw error;
    }
  }
  if (name === "get_agent_host_validation" || name === "stop_agent_host_validation" || name === "continue_agent_host_validation") {
    const taskId = stringArgument(argumentsValue, "taskId");
    if (taskId === null) {
      return {
        isError: true,
        structuredContent: { error: { code: "INVALID_TOOL_INPUT", message: "taskId \u4E0D\u80FD\u4E3A\u7A7A\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u64CD\u4F5C\u5BBF\u4E3B\u9A8C\u8BC1\uFF1AtaskId \u4E0D\u80FD\u4E3A\u7A7A\u3002" }]
      };
    }
    const state = name === "get_agent_host_validation" ? hostValidation.get(taskId) : name === "stop_agent_host_validation" ? await hostValidation.stop(taskId) : await hostValidation.continue(taskId);
    return hostValidationResult(
      state,
      `Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1\u72B6\u6001\uFF1A${state.status}\u3002`
    );
  }
  throw new Error(`\u672A\u77E5\u5DE5\u5177\uFF1A${String(name)}`);
}
function createNarracutRequestHandler(options = {}) {
  const hostValidation = new AgentHostValidationService(
    options.codexHost ?? new CodexAppServerHost()
  );
  const workspace = new ProjectWorkspaceSession({
    ttsFetch: options.ttsFetch,
    probeSpeechDurationMs: options.probeSpeechDurationMs
  });
  const requestHandler = async (request) => {
    switch (request.method) {
      case "initialize": {
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "narracut", version: SERVER_VERSION },
          instructions: "\u53EA\u63A5\u89E6\u7528\u6237\u901A\u8FC7\u7CFB\u7EDF\u6587\u4EF6\u5939\u9009\u62E9\u7A97\u53E3\u6216\u53C2\u6570\u660E\u786E\u7ED9\u51FA\u7684\u76EE\u5F55\u3002\u53EF\u4EE5\u5728\u4E0D\u5B58\u5728\u7684\u76EE\u6807\u539F\u5B50\u521B\u5EFA Project VNext\uFF0C\u6216\u4E25\u683C\u6253\u5F00\u6709\u6548\u9879\u76EE\uFF1B\u8868\u683C\u5DE5\u4F5C\u533A\u53EA\u4FEE\u6539 Scene \u4E0E Narration\uFF0CAgent \u5DE5\u4F5C\u533A\u53EF\u663E\u5F0F\u521B\u5EFA\u3001\u8BFB\u53D6\u6216\u653E\u5F03\u552F\u4E00\u5019\u9009\uFF0C\u5E76\u53EF\u8FD0\u884C\u56FA\u5B9A\u7684\u53EA\u8BFB Codex \u521B\u4F5C\u7EBF\u7A0B\u5BBF\u4E3B\u9A8C\u8BC1\uFF1B\u53D7\u63A7\u5DE5\u5177\u53EA\u539F\u5B50\u4FEE\u6539\u5019\u9009\uFF0C\u4E0D\u4FEE\u6539\u5F53\u524D\u4FEE\u8BA2\u3002"
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools };
      case "tools/call":
        return callTool(request.params, hostValidation, workspace);
      case "resources/list":
        return {
          resources: [{
            uri: WORKBENCH_URI,
            name: "Narracut \u5DE5\u4F5C\u53F0",
            description: "Project VNext \u542F\u52A8\u5668\u3001\u53EF\u7F16\u8F91 Scene \u63A5\u89E6\u8868\u4E0E\u53EA\u8BFB Agent \u5DE5\u4F5C\u533A",
            mimeType: "text/html;profile=mcp-app"
          }]
        };
      case "resources/read": {
        const uri = typeof request.params === "object" && request.params !== null ? request.params.uri : void 0;
        if (uri !== WORKBENCH_URI) throw new Error(`\u672A\u77E5\u8D44\u6E90\uFF1A${String(uri)}`);
        return {
          contents: [{
            uri: WORKBENCH_URI,
            mimeType: "text/html;profile=mcp-app",
            text: await loadWorkbench(),
            _meta: {
              ui: {
                prefersBorder: false,
                csp: { connectDomains: [], resourceDomains: [], frameDomains: [await workspace.preview.source.origin()] }
              }
            }
          }]
        };
      }
      default:
        throw new Error(`\u4E0D\u652F\u6301\u7684\u65B9\u6CD5\uFF1A${request.method}`);
    }
  };
  return Object.assign(requestHandler, {
    dispose: async () => {
      await workspace.dispose();
      await hostValidation.dispose();
    }
  });
}
var handleRequest = createNarracutRequestHandler();
function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}
`);
}
async function handleLine(line, requestHandler) {
  if (line.trim() === "") return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    writeMessage({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (request.id === void 0) return;
  try {
    writeMessage({ jsonrpc: "2.0", id: request.id, result: await requestHandler(request) });
  } catch (error) {
    writeMessage({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" }
    });
  }
}
async function startStdioServer(requestHandler = handleRequest) {
  let inputBuffer = "";
  process.stdin.setEncoding("utf8");
  const keepAlive = setInterval(() => void 0, 6e4);
  try {
    for await (const chunk of process.stdin) {
      inputBuffer += chunk;
      const lines = inputBuffer.split("\n");
      inputBuffer = lines.pop() ?? "";
      for (const line of lines) await handleLine(line, requestHandler);
    }
    if (inputBuffer.trim() !== "") await handleLine(inputBuffer, requestHandler);
  } finally {
    clearInterval(keepAlive);
    await requestHandler.dispose();
  }
}
if (process.argv[1] === fileURLToPath3(import.meta.url)) await startStdioServer();
export {
  createNarracutRequestHandler,
  handleRequest,
  startStdioServer
};
