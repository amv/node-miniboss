/// <reference path="node.d.ts" />

import * as net from 'net';
import * as events from 'events';
import * as crypto from 'crypto';
import * as stream from 'stream';

var gearman_packet = require('gearman-packet');
var through = require('through2');
var uuid = require('uuid');

let packet_handler_lists = {
    common_handler : 'OPTION_REQ ECHO_REQ',
    client_handler : 'SUBMIT_JOB',
    worker_handler : 'CAN_DO CANT_DO RESET_ABILITIES PRE_SLEEP GRAB_JOB GRAB_JOB_UNIQ WORK_COMPLETE WORK_FAIL WORK_EXCEPTION WORK_DATA SET_CLIENT_ID WORK_WARNING CAN_DO_TIMEOUT',
};

let packet_handler_lookup = {};

for ( let handler in packet_handler_lists ) {
    packet_handler_lists[handler].split(" ").forEach( (task_name) => {
        packet_handler_lookup[ task_name ] = handler;
    } );
}

export function create_listening_miniboss( port: number, host: string, callback: Function ) {
    let mb = new Miniboss();
    mb.listen( port, host, callback );
    return mb;
}

class Miniboss extends events.EventEmitter {
    private server: net.Server;
    private connections: { [id: string ] : MinibossConnection } = {};
    private jobs_by_id: { [id: string ] : MinibossJob } = {};

    private _listening: boolean = false;
    private _port: number = 4730;
    private _hostname: string = 'localhost';

    public debug_mode: boolean = false;
    public silent_mode: boolean = false;

    public log_debug( ...args ) { if ( this.debug_mode ) { console.error( args ); } }
    public log_info( ...args ) { if ( ! this.silent_mode ) { console.log( args ); } }
    public log_error( ...args ) { console.error( args ); }

    listening() { return this._listening }
    port() { return this._port }
    hostname() { return this._hostname }

    listen( port?: number, hostname?: string, callback?: Function ) {
        this._port = port || this._port;
        this._hostname = hostname || this._hostname;

        this.server = net.createServer();
        this.server.on('listening', address => { this.handle_listening(address, callback)} );
        this.server.on('connection', socket => { this.handle_connection(socket) });
        this.server.on('error', error => { this.handle_error(error) });

        this.server.listen( this._port, this._hostname );
    }
    close( callback: Function ) {
        this.server.close( callback );
    }
    handle_listening( address: string, callback?: Function ) {
        this._listening = true;
        this.emit('listening');
        if ( callback ) { callback( address ); }
    }
    handle_connection( socket: net.Socket ) {
        this.emit('connected');
        let connection = new MinibossConnection( this, socket );
        this.connections[ connection.id() ] = connection;
    }
    handle_error( error ) {
        this.emit('error', error);
        this.log_debug( error );
    }
    register_job( job : MinibossJob ) {
        this.jobs_by_id[ job.id() ] = job;
    }
    unregister_job_by_id( job_id : string ) {
        delete this.jobs_by_id[ job_id ];
    }
    job_by_id( job_id: string ) : MinibossJob | void {
        return this.jobs_by_id[ job_id ];
    }
    find_worker_for_job( job : MinibossJob ) {
        for ( let id in this.connections ) {
            this.connections[id].broadcast_job( job );
        }
    }
    find_job_for_worker( worker : MinibossConnection ) {
        for ( let id in this.connections ) {
            this.connections[id].broadcast_pending_jobs_to_worker( worker );
        }
    }
    assign_job_for_worker( worker : MinibossConnection, uniq : boolean ) {
        for ( let id in this.connections ) {
            this.connections[id].assign_pending_job_to_worker( worker, uniq );
        }
    }
}

class MinibossConnection {
    private _id: string;
    private _miniboss: Miniboss;
    private socket: net.Socket;
    private output_packet_stream: stream.Duplex;
    private common_handler: MinibossCommonPacketHandler;
    private worker_handler: MinibossWorkerPacketHandler;
    private client_handler: MinibossClientPacketHandler;

    constructor( miniboss: Miniboss, socket: net.Socket ) {
        this._miniboss = miniboss;
        this.socket = socket;

        this.common_handler = new MinibossCommonPacketHandler( miniboss, this );
        this.worker_handler = new MinibossWorkerPacketHandler( miniboss, this );
        this.client_handler = new MinibossClientPacketHandler( miniboss, this );

        this._id = uuid.v4();

        let packet_stream = this.socket.pipe(new gearman_packet.Parser());

        packet_stream.on( 'error', (error) => { this.handle_packet_error(error) });
        packet_stream.pipe( through.obj( ( packet, encoding, next ) => {
            this.handle_packet( packet );
            next();
        } ) );

        this.output_packet_stream = new gearman_packet.Emitter();
        this.output_packet_stream.pipe( this.socket );
    }

    id() { return this._id; }
    miniboss() { return this._miniboss; }
    capability_names() { return this.worker_handler.capability_names(); }
    wake_up() { return this.worker_handler.wake_up(); }
    handle_job( job : MinibossJob, uniq: boolean ) { return this.worker_handler.handle_job( job, uniq ); }

    broadcast_job( job : MinibossJob ) {
        if ( this.worker_handler.is_asleep() && this.worker_handler.can_do( job ) ) {
            this.wake_up();
        }
    }

    broadcast_pending_jobs_to_worker( worker : MinibossConnection ) {
        if ( this.client_handler.has_pending_jobs() ) {
            this.client_handler.broadcast_jobs_to_worker( worker );
        }
    }

    assign_pending_job_to_worker( worker : MinibossConnection, uniq : boolean ) {
        if ( this.client_handler.has_pending_jobs() ) {
            this.client_handler.assign_job_to_worker( worker, uniq );
        }
    }

    handle_packet( packet ) {
        this._miniboss.log_info( JSON.stringify( [ 'RECV', packet.type.name, packet.args ] ) );
        if ( packet && packet.type && packet.type.name ) {
            if ( packet_handler_lookup[ packet.type.name ] ) {
                this[ packet_handler_lookup[ packet.type.name ] ].handle_packet( packet );
            }
            else {
                this._miniboss.log_error( 'Unhandled packet type: ' + packet.type.name );
            }
        }
    }
    send_response( type, args, body? ) { this.send_packet( 'response', type, args, body ); }
    send_request( type, args, body? ) { this.send_packet( 'request', type, args, body ); }
    send_packet( kind, type, args, body? ) {
        let packet = {
            kind : kind,
            type : gearman_packet.types[type],
            args : args,
            body : body,
        };
        this._miniboss.log_debug( JSON.stringify( [ 'SEND', packet.type.name, packet.args ] ) );
        this.output_packet_stream.write( packet );
    }
    handle_packet_error( error ) {
        this._miniboss.log_error( "Packet error", error );
    }
    teardown() {
        this.common_handler.teardown();
        this.worker_handler.teardown();
        this.client_handler.teardown();
    }
}

class MinibossPacketHandler {
    private _miniboss: Miniboss;
    private _connection: MinibossConnection;

    constructor( miniboss: Miniboss, connection: MinibossConnection ) {
        this._miniboss = miniboss;
        this._connection = connection;
    }

    miniboss() { return this._miniboss; }
    connection() { return this._connection; }

    send_response( type, args, body? ) { this._connection.send_response( type, args, body ); }
    send_request( type, args, body? ) { this._connection.send_request( type, args, body ); }

    teardown() {

    }
}

class MinibossCommonPacketHandler extends MinibossPacketHandler {
    handle_packet( packet ) {
        switch ( packet.type.name ) {
            case 'OPTION_REQ':
            this.send_response( 'OPTION_RES', { option : packet.args.option } );
            break;

            case 'ECHO_REQ':
            this.send_response( 'ECHO_RES', {}, packet.body );
            break;
        }
    }
}

class MinibossClientPacketHandler extends MinibossPacketHandler  {
    private pending_jobs: { [ id : string ] : MinibossJob } = {};
    private pending_jobs_by_function_name: { [ function_name : string ] : MinibossJob[] } = {};

    has_pending_jobs() : boolean { return Object.keys(this.pending_jobs).length > 0 }

    add_pending_job( job : MinibossJob ) {
        this.pending_jobs[ job.id() ] = job;
        let fn = job.function_name();
        if ( fn in this.pending_jobs_by_function_name ) {
            this.pending_jobs_by_function_name[ fn ].push( job );
        }
        else {
            this.pending_jobs_by_function_name[ fn ] = [ job ];
        }
    }
    shift_pending_job_for_function_name( function_name : string ) : MinibossJob {
        if ( function_name in this.pending_jobs_by_function_name ) {
            let job = this.pending_jobs_by_function_name[ function_name ].shift();
            if ( this.pending_jobs_by_function_name[ function_name ].length == 0 ) {
                delete this.pending_jobs_by_function_name[ function_name ];
            }
            delete this.pending_jobs[ job.id() ];
            return job;
        }
        throw new Error("tried to unshift job for non-existing function_name: " + function_name);
    }

    broadcast_jobs_to_worker( worker : MinibossConnection) {
        for (let function_name of worker.capability_names() ) {
            if ( function_name in this.pending_jobs_by_function_name ) {
                return worker.wake_up();
            }
        }
    }

    assign_job_to_worker( worker : MinibossConnection, uniq : boolean ) {
        for (let function_name of worker.capability_names() ) {
            if ( function_name in this.pending_jobs_by_function_name ) {
                let job = this.shift_pending_job_for_function_name( function_name );
                worker.handle_job( job, uniq );
                return;
            }
        }
    }

    handle_packet( packet ) {
        switch ( packet.type.name ) {
            case 'SUBMIT_JOB':
                let job = MinibossJob.create_from_packet_and_client( packet, this.connection() );
                this.miniboss().register_job( job );
                this.add_pending_job( job );
                this.send_response('JOB_CREATED', { job : job.id() } );
                this.miniboss().find_worker_for_job( job );
            break;
        }
    }
}

class MinibossWorkerPacketHandler extends MinibossPacketHandler {
    private capabilities: { [ job_name: string ] : number } = {};
    private handled_jobs: { [ id : string ] : MinibossJob } = {};
    private _is_asleep: boolean;

    is_asleep() : boolean { return this._is_asleep }
    capability_names() : string[] { return Object.keys( this.capabilities ); }

    wake_up() {
        this._is_asleep = false;
        this.send_response('NOOP', {});
    }
    go_to_sleep() {
        this._is_asleep = true;
        this.miniboss().find_job_for_worker( this.connection() );
    }
    handle_job( job : MinibossJob, uniq : boolean ) {
        this.handled_jobs[ job.id() ] = job;
        this.send_response( uniq ? 'JOB_ASSIGN_UNIQ' : 'JOB_ASSIGN', {
            job: job.id(),
            function: job.function_name(),
            uniqueid : job.id()
        }, job.body() );
    }

    handle_packet( packet ) {
        switch ( packet.type.name ) {
            case 'WORK_COMPLETE':
            case 'WORK_FAIL':
                // TODO: mark packet connection bindings to be cleared
                this.forward_packet_as_response_to_job_client( packet, packet.args.job );
                this.miniboss().unregister_job_by_id( packet.args.job )
            break;

            case 'WORK_EXCEPTION':
            case 'WORK_WARNING':
            case 'WORK_DATA':
                this.forward_packet_as_response_to_job_client( packet, packet.args.job );
            break;

            case 'CAN_DO':
                this.capabilities[ packet.args.function ] = -1;
            break;

            case 'CAN_DO_TIMEOUT':
                this.capabilities[ packet.args.function ] = packet.args.timeout * 1000;
            break;

            case 'CANT_DO':
                delete this.capabilities[ packet.args.function ];
            break;

            case 'RESET_ABILITIES':
                for ( let function_name in this.capabilities ) {
                    delete this.capabilities[ function_name ];
                }
            break;

            case 'SET_CLIENT_ID':
            //
            break;

            case 'PRE_SLEEP':
                this.go_to_sleep();
            break;


            case 'GRAB_JOB':
                this.miniboss().assign_job_for_worker( this.connection(), false );
            break;

            case 'GRAB_JOB_UNIQ':
                this.miniboss().assign_job_for_worker( this.connection(), true );
            break;
        }
    }

    can_do( job : MinibossJob ): boolean {
        return job.function_name() in this.capabilities;
    }

    forward_packet_as_response_to_job_client( packet, job_id ) {
        let job = this.miniboss().job_by_id( job_id );
        if ( job ) {
            ( job as MinibossJob ).client().send_response( packet.type.name, packet.args, packet.body );
        }
        else {
            // TODO: do cleanup for task whose client has gone missing
        }
    }
}

class MinibossJob {
    private _id : string;
    private _function_name : string;
    private _body : Buffer | void;
    private _client : MinibossConnection;
    public worker : MinibossConnection;

    static create_from_packet_and_client( packet, client : MinibossConnection ) : MinibossJob {
        let job = new MinibossJob( client, packet.args['function'], packet.body );
        return job;
    }

    constructor( client : MinibossConnection, function_name: string, body : Buffer | void ) {
        this._id = uuid.v4();
        this._function_name = function_name;
        this._body = body;
        this._client = client;
    }

    id() { return this._id }
    function_name() { return this._function_name }
    body() { return this._body }
    client() { return this._client }

}
