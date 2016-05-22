/* jshint esversion: 6 */

var miniboss = require('../../lib/miniboss.js');

exports.MinibossHelper = class {
    constructor() {
        this.used_minibosses = [];
    }
    create_local_miniboss_with_random_port_until_success( callback, round, last_error ) {
        round = round || 1;
        if ( round > 20 ) {
            throw new Error( "Could not bind miniboss to a random port with 20 tries. Last error was " + last_error );
        }
        var server = this._create_local_miniboss_with_random_port();
        server.debug_mode = false;
        server.silent_mode = true;

        var success = false;
        server.on('error', err => {
            if ( ! success ) {
                this.create_local_miniboss_with_random_port_until_success( callback, round + 1, err );
            }
        } );
        server.on('listening', addr => {
            success = true;
            this.used_minibosses.push( server );
            callback( server );
        } );
    }
    tear_down() {
        this.used_minibosses.forEach( server => {
            if ( server.listening ) {
                server.close();
            }
        } );
    }
    _create_local_miniboss_with_random_port() {
        var port = 1025 + Math.floor( Math.random( 65535 - 1025 ) );
        return miniboss.create_listening_miniboss( port, 'localhost');
    }
};
