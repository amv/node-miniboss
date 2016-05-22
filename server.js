#!/usr/bin/env node

/*jslint node:true */

var miniboss = require('./lib/miniboss');
var minimist = require('minimist');

var args = minimist(process.argv.slice(2));

miniboss.create_listening_miniboss(args.port || 4730, args.host || 'localhost', function( hey ) {
    console.log( "Server started on port " + ( args.port || 4730 ) );

} );
