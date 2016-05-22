/* jshint esversion: 6 */

var gearman = require('abraxas');

exports.GearmanHelper = class {
    constructor() {
        this.used_clients = [];
    }
    create_connected_client_for_single_server( server, callback, round, last_error ) {
        var address = server.hostname() + ":" + server.port();
        round = round || 1;
        if ( round > 20 ) {
            throw new Error( "Could not connect client to a server at " + address + " in 20 tries. Last error was: " + last_error );
        }
        var client = gearman.Client.connect({ servers: [ address ], defaultEncoding:'utf8' }, err => {
            if (err) {
                this.create_connected_client_for_single_server( server, callback, round + 1, last_error );
            }
            else {
                this.used_clients.push( client );
                callback( client );
            }
        } );
    }
    tear_down() {
        this.used_clients.forEach( client => {
            client.disconnect();
        } );
    }
};
