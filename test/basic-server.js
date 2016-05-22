/* jshint esversion: 6 */

var tap = require('tap');
var MinibossHelper = require('./lib/miniboss_helper.js').MinibossHelper;
var GearmanHelper = require('./lib/gearman_helper.js').GearmanHelper;

tap.test("server can be connected", t => {
    var miniboss_helper = new MinibossHelper();
    var gearman_helper = new GearmanHelper();
    miniboss_helper.create_local_miniboss_with_random_port_until_success( server => {
        gearman_helper.create_connected_client_for_single_server( server, ( client ) => {
            t.pass();
            t.end();
        } );
    } );
    t.tearDown( () => {
        gearman_helper.tear_down();
        miniboss_helper.tear_down();
    });
});
