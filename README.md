# node-miniboss

A distributed job server inspired by [Gearman](http://gearman.org/)

## Vaporware notice

This readme acts as a project specification. The server will be done when it will be done.

## Installation

    npm install miniboss
    npm start

This starts the server listening to the standard Gearman port 4730. Or with an alternate port:

    npm install -g miniboss
    miniboss -p 4731

## What is Miniboss

Miniboss is a distributed job server much like [Gearman](http://gearman.org/). It uses the Gearman protocol to talk to clients and workers, but it is not a full Gearman server implementation, and will purposefully stay that way.

At some point we will have a link here, which will lead to a tutorial on how Miniboss works with Worker processes and Client processes. But for now we just expect that you know how Gearman foreground jobs work, and Miniboss works exactly the same way.

## How does Miniboss differ from Gearman

The main difference between a full Gearman server implementation and Miniboss is that Miniboss does not support background jobs. Miniboss also comes out of the box with some helpful Gearman protocol additions that allow speedier recovery in multitude of failure scenarios.

If you need background jobs, you can for example schedule them from an external system, using convenient Miniboss functions. We suggest using [Gearsloth](https://github.com/meetings/gearsloth), which is designed specifically for this purpose. You will also get pretty resilient delayed job system in the same package!

## Why does Miniboss exist

Miniboss aims to take the elegant essence of Gearman and hone it to become a reliable core building block for distributed systems. The goals are outlined below:

* Horizontally scalable
* No single point of failure
* Easy for ops to maintain
* Fast failovers
* Easy to monitor and inspect
* Awareness of data centers

So how do we aim to reach these goals?

### Horizontal scalability

Horizontal scalability is an inherent feature of the Gearman protocol model. Almost any number of Worker machines can be attached to each Miniboss server, and almost any number of Miniboss servers can work side by side routing requests from Clients to Workers and back. Good job Gearman!

### No single point of failure

Having no single points of failure is also an inherent feature of the Gearman protocol model. You can always have more than one worker for all available jobs simultaneously, and you can always have more than one Miniboss server through which the client can request the jobs. Good job again Gearman!

### Easy for ops to maintain

On the outskirts it looks like easy maintainability would also be an inherent feature of the Gearman protocol model, as the Clients can always choose a different routing server in the case of one being down for maintenance, upgrade or otherwise in a failed state. You just shut the server down, and bring it back up when maintenance is done.

However the development of the Gearman daemons have in the recent years veered towards supporting different levels of background execution and delayed execution logic. This logic has the unfortunate side-effect of introducing more state to the running server processes, which makes maintenance of the Gearman servers a more complicated affair.

Due to the background execution logic, operators need to know wether there are unexecuted background jobs waiting in the memory of the process and thus if the server can safely be shut down without losing something. If the operator has set up some sort of a persistence layer for the background jobs, failed servers can no longer be just replaced with a freshly bootstrapped ones, and crashed servers might need to go through lengthy processes of sorting through corrupted database files.

Miniboss takes the highly opinnionated stance that in order to achieve a reliable system, the routing server should not contain any such state, that some other party is not responsible for recovering from the loss of that state. To enforce this, Miniboss drops the support of background jobs completely. Because this leaves us with only foreground jobs, and Client code is responsible for handling the retries and error situations in case of broken connections, the operators can work on the assumption that Miniboss servers are completely stateless routing units. Hooray for easy maintenance! Just cut the power and bootstrap a new Miniboss Docker image to replace your outdated and failed Minibosses, and you are done!

### Fast failovers

Miniboss comes out of the box with a Gearman protocol extension for SUBMIT_JOB_TIMEOUT that allows Clients to submit jobs with a routing timeout. This means that if the Client submits a job with a 200 millisecond routing timeout and Miniboss responds with a ROUTING_TIMEOUT, the Client can be absolutely sure the job was not assigned to any worker, and a different Miniboss can be contacted to do the job.

The Client can add a bit of time to the routing timeout after each failure, which allows Clients to start with a very slow routing timeout. This allows quickly bypassing those Minibosses, which for some reason can not route the job quickly (or at all), but also still works very well in the case of real Worker overload.

It also might be that, that CAN\_DO will not be implemented and CAN\_DO\_TIMEOUT will be the only possible way to register Workers. Somebody might be able to talk me out of this though, as variable timeouts that are controlled by the Client based on progress reports sent by the Worker might actually be a good idea in some situations.

### Easy to monitor and inspect

This part is not really thought out yet. Some kind of access log could be nice in order to plot out nice graphs with an ELK stack.

It would also be really nice to have better introspection commands so that an external monitor could alert admins in case some required functions have no workers, or to enable some sort of automatic provisioning of more resources in cases of high loads.

### Awareness of data centers

This is way down the roadmap, but the idea would be to have zero configuration on the Miniboss servers.

Instead of configuration, we would allow workers to signal their area tags, and clients to signal their area tag priority queue. Workers in DC1 would signal "IDENTIFY\_AREA DC1", and Clients in DC1 would signal "AREA\_PRIORITY DC1,DC3". After this all jobs arriving from Clients in DC1 would be passed on only to Workers that have identified their area as DC1. If the routing timeout elapses, the job would be passed to Workers with area DC3, and after that to all other workers.

This would effectively tripple the requested routing timeout (double if only one AREA\_PRIORITY tag is posted), but having a different timeouts for these might be too much. One alternative might be to have something like AREA\_PRIORITY\_TIMEOUT DC1,100,DC3,200 and have the routing timeout work as previously.

There is also no reason why Workers should not be able to post more than one area indentificator.

## Are there other Miniboss implementations

Probably not yet! Maybe you could build one with your favourite language?
