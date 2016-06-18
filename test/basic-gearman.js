/* jshint esversion: 6 */

var tap = require('tap');
var MinibossHelper = require('./lib/miniboss_helper.js').MinibossHelper;
var GearmanHelper = require('./lib/gearman_helper.js').GearmanHelper;

tap.test("server passes on and returns a job", t => {
    var miniboss_helper = new MinibossHelper();
    var gearman_helper = new GearmanHelper();
    miniboss_helper.create_local_miniboss_with_random_port_until_success( server => {
        gearman_helper.create_connected_client_for_single_server( server, client => {
            client.registerWorker('toUpper', function(task) {
                return task.payload.toUpperCase();
            });
            client.submitJob('toUpper', 'test string').then(function (result) {
                t.is(result, 'TEST STRING');
                t.end();
            });
        } );
    } );
    t.tearDown( () => {
        gearman_helper.tear_down();
        miniboss_helper.tear_down();
    });
});

tap.test("server passes on and returns a job even if job was submitted before worker was present", t => {
    var worker_delay_ms = 100;
    var miniboss_helper = new MinibossHelper();
    var gearman_helper = new GearmanHelper();
    miniboss_helper.create_local_miniboss_with_random_port_until_success( server => {
        gearman_helper.create_connected_client_for_single_server( server, client => {
            client.submitJob('toUpper', 'test string').then(function (result) {
                t.is(result, 'TEST STRING');
                t.end();
            });
            setTimeout( () => {
                client.registerWorker('toUpper', function(task) {
                    return task.payload.toUpperCase();
                });
            }, worker_delay_ms );
        } );
    } );
    t.tearDown( () => {
        gearman_helper.tear_down();
        miniboss_helper.tear_down();
    });
});

tap.test("server passes on and returns 10 jobs in 1000 ms", t => {
    var total = 10;
    var timeout_ms = 1000;

    var miniboss_helper = new MinibossHelper();
    var gearman_helper = new GearmanHelper();

    miniboss_helper.create_local_miniboss_with_random_port_until_success( server => {
        gearman_helper.create_connected_client_for_single_server( server, client => {
            client.registerWorker('toUpper', function(task) {
                return task.payload.toUpperCase();
            });


            var runs = [];
            for ( let i = 0; i < total; i++ ) {
                runs.push( i );
            }

            var counter = 0;
            var failed = false;

            var failure_timeout = setTimeout( () => {
                if ( counter < total && ! failed ) {
                    failed = true;
                    t.fail(`counter reached only ${counter} before timeout`);
                    t.end();
                }
            }, timeout_ms );

            runs.forEach( run => {
                client.submitJob('toUpper', 'test string ' + run ).then(function (result) {
                    if ( failed ) { return; }
                    t.is(result, 'TEST STRING ' + run );
                    counter++;
                    if ( counter == total ) {
                        clearTimeout( failure_timeout );
                        t.end();
                    }
                } );
            } );
        } );
    } );

    t.tearDown( () => {
        gearman_helper.tear_down();
        miniboss_helper.tear_down();
    });
});

tap.test("server passes on and returns 10 jobs correctly and concurrently with 3 workers despite varying worker timeouts", t => {
    var total = 10;
    var worker_process_count = 3;
    var timeout_ms = 2000;
    var run_delays = [ 100, 0, 50, 0, 40, 40, 40, 100, 0, 90 ];

    var miniboss_helper = new MinibossHelper();
    var gearman_helper = new GearmanHelper();

    miniboss_helper.create_local_miniboss_with_random_port_until_success( server => {
        var worker_promises = [];
        var worker_promise_resolver = resolve => {
            gearman_helper.create_connected_client_for_single_server( server, client => {
                client.registerWorker('toUpper', function(task) {
                    var task_data = JSON.parse( task.payload );
                    return new Promise( resolve => {
                        setTimeout( () => {
                            resolve( task_data.string.toUpperCase() );
                        }, task_data.timeout_ms );
                    } );
                });
                resolve();
            } );
        };

        for( let i = 0; i < worker_process_count; i++ ) {
            worker_promises.push( new Promise( worker_promise_resolver ) );
        }

        Promise.all( worker_promises ).then( () => {
            gearman_helper.create_connected_client_for_single_server( server, client => {
                var runs = [];
                for ( let i = 0; i < total; i++ ) {
                    runs.push( i );
                }

                var counter = 0;
                var failed = false;
                var second_run_seen = false;

                var failure_timeout = setTimeout( () => {
                    if ( counter < total && ! failed ) {
                        failed = true;
                        t.fail(`counter reached only ${counter} before timeout`);
                        t.end();
                    }
                }, timeout_ms );

                runs.forEach( run => {
                    var data = {
                        string : 'test string ' + run,
                        timeout_ms : run_delays[ run ]
                    };

                    client.submitJob('toUpper', JSON.stringify( data ) ).then(function (result) {
                        if ( failed ) { return; }

                        if ( run === 1 ) {
                            second_run_seen = true;
                        }

                        if ( run === 0 ) {
                            t.ok( second_run_seen, "second job should always complete before first one because it has 0 ms delay and the first one has a 100 ms delay" );
                        }

                        t.is(result, 'TEST STRING ' + run, `Run ${run} should have correct count ${run}` );

                        counter++;

                        if ( counter == total ) {
                            clearTimeout( failure_timeout );
                            t.end();
                        }
                    } );
                } );
            } );
        } );
    } );

    t.tearDown( () => {
        gearman_helper.tear_down();
        miniboss_helper.tear_down();
    });
});
