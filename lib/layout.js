'use strict';

var _ = require('lodash');
var layout = require('layout');
var through2 = require('through2');
var path = require('path');
var Err = require('./util/error');

var tiledImages;
var bypassedImages;
var partitions;

var addTile = function (opt) {
  return function (tile, enc, cb) {
    if (tile instanceof Error) {
      cb(tile);
    } else {
      if (tile && tile.width && tile.height) {
        var bypassSize = opt['bypass-size'];
        if (bypassSize && (tile.height > bypassSize || tile.width > bypassSize)) {
          tile.bypassed = true;
          bypassedImages.push(tile);
        } else {
          tiledImages.push(tile);
        }
      }
      cb();
    }
  };
};

var nearestMultiOf4 = function (x) {
  return Math.floor((x+3)/4) * 4;
};

var tileMargin = function (opt, tiles) {
  return (tiles.length > 1) ? opt.margin * 2 : 0;
};

var createLayout = function (opt, tiles) {
  var l = layout('binary-tree');

  _.each(tiles, function (tile) {
    var height = tile.height + tileMargin(opt, tiles);
    var width = tile.width + tileMargin(opt, tiles);
    var item = {
      height: height,
      width: width,
      meta: tile
    };
    l.addItem(item);
  });

  return l.export();
};

var isInMaxSize = function (opt, tiles) {
  var splitMaxSize = opt['split-max-size'];
  if (splitMaxSize) {
    var l = createLayout(opt, tiles);
    if (l.height > splitMaxSize || l.width > splitMaxSize) {
      return false;
    }
  }
  return true;
};

var pushPartition = function (opt, tiles) {
  if (!tiles.length) {
    return [];
  }

  if (tiles.length === 1 || isInMaxSize(opt, tiles)) {
    partitions.push(tiles);
    return [];
  }

  // Sort
  tiles = tiles.sort(function(a, b) {
    // TODO: check that each actually HAS a width and a height.
    // Sort based on the size (area) of each block.
    return (b.width * b.height) - (a.width * a.height);
  });

  while (!isInMaxSize(opt, tiles)) {
    for (var i=0; i<tiles.length-1; ++i) {
      if (isInMaxSize(opt, tiles.slice(0, i+1)) && !isInMaxSize(opt, tiles.slice(0, i+2))) {
        partitions.push(tiles.slice(0, i+1));
        tiles = tiles.slice(i+1);
        break;
      }
    }
  }

  return tiles;
};

var pushTilesToLayouts = function (opt, stream) {
  if (!tiledImages.length) {
    return;
  }

  if (isInMaxSize(opt, tiledImages)) {
    partitions.push(tiledImages);
  } else {
    var groups = _.groupBy(tiledImages, function (tile) {
      return tile.base;
    });

    var tiles = [];
    _.each(groups, function (group) {
      if (!tiles.length) {
        tiles = group;
      }
      else {
        if (!isInMaxSize(opt, tiles.concat(group))) {
          tiles = pushPartition(opt, tiles);
        }

        tiles = tiles.concat(group);
      }
    });

    tiles = pushPartition(opt, tiles);
    if (tiles.length) {
      tiles = pushPartition(opt, tiles);
    }

    if (tiles.length) {
      var e = new Err.LayoutError();
      stream.emit('error', e);
    }
  }

  _.each(partitions, function (partition, key) {
    var l = createLayout(opt, partition);

    l.width = nearestMultiOf4(l.width);
    l.height = nearestMultiOf4(l.height);

    stream.push({
      name: 'default-' + key,
      layout: l
    });
  });
};

var pushLayouts = function (opt) {
  return function (cb) {
    var stream = this;
    if (!tiledImages.length && !bypassedImages.length) {
      var e = new Err.LayoutError();
      stream.emit('error', e);
      return;
    }

    pushTilesToLayouts(opt, stream);

    _.each(bypassedImages, function (image) {
      stream.push(image);
    });

    cb();
  };
};

module.exports = function (opt) {
  tiledImages = [];
  bypassedImages = [];
  partitions = [];

  return through2.obj(addTile(opt), pushLayouts(opt));
};
