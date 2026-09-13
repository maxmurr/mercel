# Run application containers in k3d

The four application Applications deploy into namespace `mercel`. PostgreSQL,
Redis, and RustFS remain in their own namespaces. Each container reads only its
required keys from the `mercel-runtime` Secret; no credentials are baked into
images or stored in workload manifests.

| Application | Workload | Image imported into k3d | Service |
| --- | --- | --- | --- |
| upload-server | Deployment | `mercel-upload-server:local` | `upload-server:3000` |
| deploy-worker | Deployment with Docker sidecar | `mercel-deploy-worker:local` | None |
| request-handler-server | Deployment | `mercel-request-handler:local` | `request-handler-server:3001` |
| web-client | StatefulSet | `mercel-web-client:local` | `web-client:3002` |

## Prepare before Git sync

Run commands from the repository root. Check `kubectl config current-context`.
These commands target the existing `mercel-local` k3d cluster; replace that name
if using another cluster. Argo CD reads `main`, not uncommitted files.

First complete the [data-service bootstrap](README.md#bootstrap). Apply database
migrations and create the private `mercel` bucket as described there. Argo CD does
not run migrations or create the bucket. Stop host app processes, including the
host deploy worker, before running the containerized apps.

Copy the application credentials template and fill in your GitHub OAuth and
OpenCode credentials. The local database/Redis/S3 credentials must match the
existing infrastructure Secrets. Register the GitHub OAuth callback as
`http://localhost:3002/api/auth/callback/github`.

```sh
cp -n infra/.env.example infra/.env
# Edit infra/.env before continuing. It is gitignored.
kubectl create namespace mercel --dry-run=client -o yaml | kubectl apply -f -
kubectl -n mercel create secret generic mercel-runtime --from-env-file=infra/.env
```

Secret creation refuses to overwrite an existing Secret. To update it later,
use `kubectl -n mercel edit secret mercel-runtime`, then restart the affected
workloads. Changing a Secret does not update running environment variables.
Do not copy host `.env` URLs into this Secret: pod loopback is not your host.

## Build and import images

Application images use `imagePullPolicy: Never`: no registry or credentials are
needed for local k3d. Build all four images and import them before pushing the
Applications to `main`. Missing imports produce `ErrImageNeverPull`.

```sh
docker build -f apps/upload-server/Dockerfile -t mercel-upload-server:local .
docker build -f apps/deploy-worker/Dockerfile -t mercel-deploy-worker:local .
docker build -f apps/request-handler-server/Dockerfile -t mercel-request-handler:local .
docker build -f apps/web-client/Dockerfile -t mercel-web-client:local \
  --build-arg NEXT_PUBLIC_UPLOAD_SERVER_URL=http://localhost:3000 \
  --build-arg NEXT_PUBLIC_PREVIEW_BASE_URL=http://localhost:3001 .

k3d image import -c mercel-local \
  mercel-upload-server:local mercel-deploy-worker:local \
  mercel-request-handler:local mercel-web-client:local
```

The web build embeds browser URLs. Server publishing instead uses runtime
`UPLOAD_SERVER_URL=http://upload-server.mercel.svc.cluster.local:3000`. It falls
back to `NEXT_PUBLIC_UPLOAD_SERVER_URL` when unset, preserving host development.
Do not replace the public URL with cluster DNS: the browser cannot resolve it.

Commit and push the manifests and source change to `main`; the existing root
Application discovers the four new Applications. For a cluster without the root:

```sh
kubectl apply -f infra/envs/default/default.yaml
```

After rebuilding a `:local` image, import it again and restart the corresponding
workload. For reproducible releases, replace `:local` with immutable registry
tags/digests and change the pull policy instead of relying on this local workflow.

```sh
kubectl -n mercel rollout restart deployment/upload-server
kubectl -n mercel rollout restart deployment/deploy-worker
kubectl -n mercel rollout restart deployment/request-handler-server
kubectl -n mercel rollout restart statefulset/web-client
```

## Verify startup

```sh
kubectl get applications -n argocd
kubectl -n mercel rollout status deployment/upload-server --timeout=300s
kubectl -n mercel rollout status deployment/deploy-worker --timeout=900s
kubectl -n mercel rollout status deployment/request-handler-server --timeout=300s
kubectl -n mercel rollout status statefulset/web-client --timeout=300s
kubectl -n mercel get pods,pvc
kubectl -n mercel logs deployment/deploy-worker -c deploy-worker --tail=30
```

The worker should log `worker_start` without queue errors. It has no HTTP or
queue-health endpoint; Docker readiness only establishes daemon availability.
The other probes establish HTTP/TCP availability, not database/S3 correctness.

The Docker sidecar is a native sidecar and requires Kubernetes 1.29 or newer with
`SidecarContainers` enabled. The existing k3d cluster runs 1.31.

## Open local services

Keep each command running in a separate terminal. Ports must be free of host
app processes.

```sh
kubectl -n mercel port-forward svc/web-client 3002:3002
kubectl -n mercel port-forward svc/upload-server 3000:3000
kubectl -n mercel port-forward svc/request-handler-server 3001:3001
```

Open `http://localhost:3002`. Published sites use
`http://<deployment-id>.localhost:3001`; the browser's Host header reaches the
request handler unchanged. Test sign-in, then publish a trusted small project,
wait for completion, and open its published site.

### Live sandbox previews

Live Vite previews still return dynamically allocated localhost URLs. Forwarding
port 3002 does not forward those ports. For local testing, forward the exact port
reported by that thread, for example:

```sh
kubectl -n mercel port-forward pod/web-client-0 5173:5173
```

Automatic preview routing for remote browsers is not implemented by these
manifests. Keep one web replica: sandbox processes and their cache are in memory.
The StatefulSet retains `.sandbox` on a 10 GiB PVC and replaces one pod at a time;
preview processes do not survive restarts. npm cache and sandbox profiles are
ephemeral.

## Build and sandbox permissions

The worker has a privileged Docker-in-Docker sidecar. This is for trusted local
projects only, not hostile tenants or a shared production node. A privileged
container can compromise its node. The application container stays non-root;
build containers retain the limits and capability restrictions in `buildApp`.

The daemon listens only on a shared Unix socket, never a TCP port. No host Docker
socket is mounted. Both containers mount the same `emptyDir` at
`/app/apps/deploy-worker/output`, so absolute bind paths passed by `buildApp`
resolve inside the daemon. Docker cache and scratch files are ephemeral. Image
pulls need Internet access; the first build pulls `node:24-bookworm-slim`. The
660-second termination grace lets the worker drain before the native sidecar
stops. Increase it for large transfers.

The web container remains non-root and drops all capabilities, but its seccomp
and AppArmor profiles are unconfined so Bubblewrap can create nested user
namespaces. This reduces container isolation. Never work around a sandbox error
by making the web container privileged or disabling Bubblewrap. Validate the
node's support before using chat commands:

```sh
kubectl -n mercel exec web-client-0 -- \
  bwrap --unshare-user --ro-bind / / -- /bin/true
```

The pod shares its process namespace so the pod sandbox's PID 1 can reap orphaned
preview processes. If the Bubblewrap check fails, investigate node user-namespace
policy before proceeding. These local permissions, sample credentials, and plain
HTTP URLs must not be carried into a public deployment.
