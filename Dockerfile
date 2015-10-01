FROM node:4

# Run strong-central as an unprivileged user
RUN useradd \
    --home /var/lib/strong-central \
    --skel /dev/null \
    --create-home --user-group --system \
    strong-central

# Create standard locations where strong-central will run from and
# where it will read SSL certificates from
RUN mkdir -p /data /certs \
 && chown -R strong-central:strong-central /data /certs

# Run everything from this point forward in the context of the
# unprivileged strong-central user, inside its HOME directory
WORKDIR /var/lib/strong-central
ENV HOME=/var/lib/strong-central
USER strong-central

# Add the current directory (strong-central source) to the container
COPY . /var/lib/strong-central/

# Install production dependencies
RUN npm install --production --registry=http://ci.strongloop.com:4873/ \
 && npm cache clear

# Define in the image metadata that we expect to listen on these ports
# 8701 for http and 8702 for https
EXPOSE 8701 8702

# Environment variable to be overridden at run/start time
ENV MESHDB_URL="please set me"

# Define what is run by `docker run strongloop/strong-central`
# Additional CLI arguments can be appended at run-time
ENTRYPOINT [\
    "/usr/local/bin/node", \
    "/var/lib/strong-central/bin/sl-central.js", \
    "--base", "/data", \
    "--listen", "8701" \
]

## Expected invocation:
## docker run --detach --publish-all \
##   --name strong-central-staging \
##   -e MESHDB_URL=postgres://CREDS@URL/DB \
##   -e ADDITION_ENVS=values \
##   -v /staging/data:/data \
##   -v /staging/certs:/certs:ro \
##   strongloop/strong-central:latest \
##   --additional --central --args

## Once created using the above command, an init script would be created that
## does the following:
##    exec docker start -a strong-central-staging

## At this point, the strong-central instance is essentially "locked in" and
## any changes to the configuration should be done by destroying that
## container and a new one created in its place with the corrected config.

## To "upgrade" an instance, the expectation is that one would create a new
## container using the same arguments but a newer version of the image and
## once the new instance is running and any load balancers have been updated
## to point to the new instance's ports, the old container can be told to
## shutdown.
