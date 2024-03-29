# strong-central

This module works in concert with `strong-executor` and `strong-mesh-models` 
to provide "mesh" functionality that enables you to deploy an application 
once and have it deploy to multiple hosts running StrongLoop Executor.

**NOTE**: These modules and their commands work have only been tested
on Linux systems, but should work on OS X and Windows.

- [Basic procedure](#basic-procedure)
- [Command reference](#command-reference)
  - [sl-central](#sl-central)
  - [sl-central-install](#sl-central-install)
  - [sl-executor](#sl-executor)
  - [sl-executor-install](#sl-executor-install)
  - [sl-meshadm](#sl-meshadm)
  - [sl-meshctl](#sl-meshctl)

## Basic procedure

### 1. Install StrongLoop Central

```
$ npm install -g strong-central 
```
This makes the commands `sl-central` and `sl-central-install` available.

### 2. Start StrongLoop Central

Install and start as a service: 
```
$ sudo sl-central-install
$ sudo /sbin/initctl start strong-central
```

OR run it as a transient process:
```
$ sl-central
```

### 3. Install strong-mesh-models
You can install this on the same host as StrongLoop Central, or on a different system.

```
$ npm install -g strong-mesh-models
```
This makes the commands `sl-meshadm` and `sl-meshctl` available.

### 4. Create an executor ID

```
$ sl-meshadm -C http://<central_host>:8701 exec-create
```
OR if you installed strong-mesh-models on the same host as StrongLoop Central:
```
$ sl-meshadm exec-create
```

Where:
- `<central_host>` is the host where you installed StrongLoop Central.

You’ll see a response in the console like:
```
Created Executor id: 1 token: "7cfec40c3188b4cca2dabcddceb10cc900910ed633b524cc"
```

### 5. Install executor 

On each production host where you want to run Process Manager and host applications, install executor:

```
$ npm install -g strong-executor 
```
This makes the commands `sl-executor` and `sl-executor-install` available.

### 6. Run executor

Install and start as a service:
```
$ sudo sl-executor-install  -C http://<token>@<central_host>:8701
$ sudo /sbin/initctl start strong-executor
```
OR run as a transient process:
```
$ sl-executor -C http://<token>@<central_host>:8701
```

Where:
- `<token>` is the executor token generated in step 4.
- `<central_host>` is the host where you installed StrongLoop Central.

If you ran `sl-executor`, you’ll see a response in the console like:
```
sl-executor: connected to http://<token>@<central_host>:8701
```

If you installed and started the service, you'll just see a message that the
service is running.

### 7. Deploy an app from your machine to StrongLoop Central 

```
$ slc deploy http://<central_host>:8701
```

This will deploy the app to all the executor hosts.

### 8. Use the `sl-meshctl` command to control your applications

```
$ sl-meshctl -C http://<central_host>:8701 
```

**NOTE** This command has the same sub-commands and options as [slc ctl](http://docs.strongloop.com/display/NODE/slc+ctl).

## Command reference

- [sl-central](#sl-central)
- [sl-central-install](#sl-central-install)
- [sl-executor](#sl-executor)
- [sl-executor-install](#sl-executor-install)
- [sl-meshadm](#sl-meshadm)
- [sl-meshctl](#sl-meshctl)

### sl-central

```
sl-central [options]

The Strongloop Central.

Options:
  -h,--help         Print this message and exit.
  -v,--version      Print version and exit.
  -b,--base BASE    Base directory to work in (default `.strong-central`).
  -l,--listen PORT  Listen on PORT for git pushes (default 8701).

The base directory is used to save deployed applications, for working
directories, and for any other files that need to be created.

Strongloop Central will be controllable via HTTP on the port specified. That
port is also used for deployment with strong-deploy. Basic authentication
can be enabled for HTTP by setting the STRONGLOOP_PM_HTTP_AUTH environment
variable to <user>:<pass> (eg. strong-central:super-secret).

It is also controllable using local domain sockets, which look like file paths,
and the listen path can be changed or disabled. These sockets do not support
HTTP authentication.
```

### sl-central-install

```
sl-central-install [options]

Install StrongLoop Mesh Central as a service.

Options:
  -h,--help           Print this message and exit.
  -v,--version        Print version and exit.
  -b,--base BASE      Base directory to work in (default is $HOME of the user
                      that central is run as, see --user).
  -u,--user USER      User to run central as (default is strong-central).
  -p,--port PORT      Listen on PORT (default 8701).
  -n,--dry-run        Don't write any files.
  -j,--job-file FILE  Path of Upstart job to create (default is
                      `/etc/init/strong-central.conf`).
  -f,--force          Overwrite existing job file if present.
  --upstart VERSION   Specify Upstart version, 1.4 or 0.6 (default is 1.4).
  --systemd           Install as a systemd service, not an Upstart job.
  --http-auth CREDS   Enable HTTP authentication using Basic auth, requiring
                      the specified credentials for every request sent to the
                      REST API where CREDS is given in the form of
                      `<user>:<pass>`.

OS Service support:

The --systemd and --upstart VERSION options are mutually exclusive.  If neither
is specified, the service is installed as an Upstart job using a template that
assumes Upstart 1.4 or higher.
```

### sl-executor

```
sl-executor [options]

The Strongloop executor.

Options:
  -h,--help           Print this message and exit.
  -v,--version        Print version and exit.
  -b,--base BASE      Base directory to work in (default `.strong-executor`).
  -C,--control URL    Connect to central at this URL.
  -P,--base-port PORT Applications run on `PORT + instance ID` (default 3000).

The base directory is used to save deployed applications, for working
directories, and for any other files the executor needs to create.
```

### sl-executor-install

```
sl-executor-install [options]

Install the StrongLoop Mesh Executor as a service.

Options:
  -h,--help           Print this message and exit.
  -v,--version        Print version and exit.
  -b,--base BASE      Base directory to work in (default is $HOME of the user
                      that executor is run as, see --user).
  -C,--control URL    Connect to central at this URL.
  -u,--user USER      User to run executor as (default is strong-executor).
  -P,--base-port PORT Applications run on PORT + instance ID (default 3000).
  -n,--dry-run        Don't write any files.
  -j,--job-file FILE  Path of Upstart job to create (default is
                      `/etc/init/strong-executor.conf`).
  -f,--force          Overwrite existing job file if present.
  --upstart VERSION   Specify Upstart version, 1.4 or 0.6 (default is 1.4).
  --systemd           Install as a systemd service, not an Upstart job.

OS Service support:

The --systemd and --upstart VERSION options are mutually exclusive.  If neither
is specified, the service is installed as an Upstart job using a template that
assumes Upstart 1.4 or higher.
```

### sl-meshadm

```
sl-meshadm [options] [command ...]

Administration of the Strongloop Mesh.

Options:
  -h,--help               Print help and exit.
  -v,--version            Print version and exit.
  -C,--control CTL        Control endpoint for process manager.

The control endpoint for the process manager is searched for if not specified,
in this order:

1. `STRONGLOOP_PM` in environment: may be a local domain path, or an HTTP URL.
2. `http://localhost:8701`: a process manager running on localhost

Executor commands:

`EXEC` is the executor ID. It can be obtained by listing executors using
`exec-list`.

  exec-create             Create an executor.
  exec-remove EXEC        Remove executor EXEC.
  exec-list               List executors.
  exec-shutdown EXEC      Shutdown executor EXEC.
```

### sl-meshctl

```
sl-meshctl [options] [command ...]

Run-time control of the Strongloop process manager.

Options:
  -h,--help               Print help and exit.
  -v,--version            Print version and exit.
  -C,--control CTL        Control endpoint for process manager.

The control endpoint for the process manager is searched for if not specified,
in this order:

1. `STRONGLOOP_PM` in environment: an HTTP URL.
2. `http://localhost:8701`: a process manager running on localhost

An HTTP URL is mandatory for remote process managers, but can also be used on
localhost. If the process manager is using HTTP authentication
then valid credentials must be set in the URL directly, such as
`http://user-here:pass-here@example.com:7654`.

When using an HTTP URL, it can optionally be tunneled over ssh by changing the
protocol to `http+ssh://`. The ssh username will default to your current user
and authentication defaults to using your current ssh-agent. The username can be
overridden by setting an `SSH_USER` environment variable. The authentication can
be overridden to use an existing private key instead of an agent by setting the
`SSH_KEY` environment variable to the path of the private key to be used.


Global commands: apply to the process manager itself

  info                    Information about the process manager.
  ls                      List services.
  shutdown                Shutdown the process manager.


Service commands: apply to a specific service

`SVC` is either a service ID or service Name. It can be obtained by listing
services using `ls` or `status`.

  create NAME             Create service named NAME.

  cluster-restart SVC     Restart the service SVC cluster workers.
        This is a zero-downtime restart, the workers are soft restarted
        one-by-one, so that some workers will always be available to service
        requests.

  env[-get] SVC [KEYS...]
        List specified environment variables for service SVC. If none are
        specified, list all variables.
  env-set SVC K=V...      Set one or more environment variables for service SVC.
  env-unset SVC KEYS...
        Unset one or more environment variables for service SVC. The
        environment variables are applied to the current application, and the
        application is hard restarted with the new environment after change
        (either set or unset).

  log-dump SVC [--follow]
        Empty the log buffer, dumping the contents to stdout for service SVC.
        If --follow is given the log buffer is continuously dumped to stdout.

  npmls SVC [DEPTH]       List dependencies of the service.

  remove SVC              Remove a service SVC.

  restart SVC             Hard stop and restart service SVC with new config.

  set-size SVC N          Set cluster size for service SVC to N workers.
        The default cluster size is the number of CPU cores.

  start SVC               Start service SVC.

  status [SVC]            Report status for service SVC, or all services if
        no SVC is provided. This is the default command.

  stop SVC                Hard stop service SVC.

  soft-stop SVC           Soft stop service SVC.
  soft-restart SVC        Soft stop and restart service SVC with new config.
        "Soft" stops notify workers they are being disconnected, and give them
        a grace period for any existing connections to finish. "Hard" stops
        kill the supervisor and its workers with `SIGTERM`.

  tracing-start SVC       Restart all workers with tracing on.

  tracing-stop SVC        Restart all workers with tracing off.


Worker commands: apply to a specific worker

A `WRK` specification is either `<SVC>.1.<PID>` or `<SVC>.1.<WID>`, where SVC
is the service ID, `1` is the executor ID (limited to 1 in this release), and
the final part is either the process ID, or the cluster worker ID.

The WRK specification can be copied directly from the output of the status
command.

  cpu-start WRK [TO [ST]]  Start CPU profiling on worker WRK.
        When TO is 0, starts the CPU profiler.

        Only supported on Linux:
          TO is the optional Smart Profiling timeout, in milliseconds (default
          is 0, no timeout). With a timeout, the profiler is activated when
          an event loop stalls longer than TO; i.e. when a script runs for too
          long. The profiling is suspended after the script returns to the
          event loop.

          ST is the number of stalls after which the profiler is stopped
          automatically (default is 0, never auto-stop). View an auto-stopped
          profile with `slc arc`.

  cpu-stop WRK [NAME]      Stop CPU profiling on worker WRK.
        The profile is saved as `<NAME>.cpuprofile`. CPU profiles must be
        loaded into Chrome Dev Tools. The NAME is optional, and defaults to
        `node.<WRK>`.

  heap-snapshot WRK [NAME] Save heap snapshot for worker WRK.
        The snapshot is saved as `<NAME>.heapsnapshot`.  Heap snapshots must be
        loaded into Chrome Dev Tools. The NAME is optional, and defaults to
        `node.<WRK>`.

  objects-start WRK        Start tracking objects on worker WRK.
  objects-stop WRK         Stop tracking objects on worker WRK.
        Object tracking is published as metrics, and requires configuration so
        that the `--metrics=URL` option is passed to the runner.

  patch WRK FILE           Apply patch FILE to worker WRK.
