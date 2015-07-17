# strong-central

StrongLoop Central

## Command reference

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
  -P,--base-port PORT Applications run on `PORT + service ID` (default 3000).

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
  -P,--base-port PORT Applications run on PORT + service ID (default 3000).
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
