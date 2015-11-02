'use strict';

var _ = require('lodash');
var layout = require('layout');
var through2 = require('through2');
var path = require('path');
var Err = require('./util/error');

var layouts;

var getOrientation = function (opt) {
  if (opt.orientation === 'vertical') {
    return 'top-down';
  }
  else {
    return opt.orientation === 'horizontal' ? 'left-right' : 'binary-tree';
  }
};

var getClassName = function (name, opt) {
  var sep = '';
  if (name === 'default') {
    name = '';
  }
  if (name.length > 0) {
    sep = '-';
  }
  if (opt.prefix) {
    return opt.prefix + sep + name;
  }
  else {
    return 'icon' + sep + name;
  }
};

var splitIndices;

var addTile = function (opt) {
  return function (tile, enc, cb) {
    if (tile instanceof Error) {
      cb(tile);
    }
    else {
      if (tile && tile.base && tile.width && tile.height) {
        var bypassSize = opt['bypass-size'];
        if (bypassSize && (tile.height > bypassSize || tile.width > bypassSize)) {
          console.info('bypass image', tile.width, 'x', tile.height, '-', tile.base);
          return cb();
        }
        var name = opt.split ? path.basename(tile.base) : 'default';
        var baseName = name;
        if (splitIndices[name]) {
          name += '-' + splitIndices[name];
        }
        if (!layouts[name]) {
          layouts[name] = layout(getOrientation(opt), {'sort': opt.sort});
        }
        var height = tile.height + 2 * opt.margin;
        var width = tile.width + 2 * opt.margin;
        var item = {
          height: height,
          width: width,
          meta: tile
        };
        layouts[name].addItem(item);
        var splitMaxSize = opt['split-max-size'];
        if (splitMaxSize) {
          var info = layouts[name].export();
          if (info.height > splitMaxSize || info.width > splitMaxSize) {
            info.items.splice(info.items.indexOf(item));
            var index = splitIndices[baseName] ? ++splitIndices[baseName] : (splitIndices[baseName] = 2);
            var next = layouts[baseName + '-' + index] = layout(getOrientation(opt), {'sort': opt.sort});
            next.addItem(item);
          }
        }
      }
      cb();
    }
  };
};

function nearestPowerOf2(x) {
  return Math.pow(2, Math.ceil(Math.log(x) / Math.log(2)))
}

var pushLayouts = function (opt) {
  return function (cb) {
    var stream = this;
    if (_.keys(layouts).length === 0) {
      var e = new Err.LayoutError();
      stream.emit('error', e);
    }
    else {
      _.each(layouts, function (l, key) {
        var item = {
          name: key,
          classname: getClassName(key, opt),
          layout: l.export()
        };
        if (opt['power-of-2-size']) {
          item.layout.width = nearestPowerOf2(item.layout.width);
          item.layout.height = nearestPowerOf2(item.layout.height);
        }
        stream.push(item);
      });
    }
    cb();
  };
};

module.exports = function (opt) {
  layouts = {};
  splitIndices = {};

  return through2.obj(addTile(opt), pushLayouts(opt));
};
