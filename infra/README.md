# Local Kubernetes infrastructure

Three Argo CD Applications in `envs/default/apps/` deploy PostgreSQL, Redis, and
RustFS into separate namespaces. Their native manifests live in `workloads/`,
outside the root Application's recursive `envs/default` source. This keeps the
root from also deploying child workloads into `argocd`.

This is a single-node k3d development setup, not a production deployment. Each
service has one replica, a headless internal Service, startup/readiness/liveness
probes, resource requests and memory limits, and a retained data PVC using k3d's
`local-path` storage class. Containers run as non-root without Kubernetes API
tokens. Image digests pin both AMD64 and ARM64 builds. RustFS is pinned to
`1.0.0-rc.6`, a prerelease matching the upstream image available at setup time.

| Application | Internal endpoint | Storage | Authentication |
| --- | --- | --- | --- |
| PostgreSQL 18 | `postgres.postgres.svc.cluster.local:5432` | 5 GiB | `postgres-auth`, key `password`; user/database `mercel` |
| Redis 8 | `redis.redis.svc.cluster.local:6379` | 2 GiB | `redis-auth`, key `password`; default user |
| RustFS | `http://rustfs.rustfs.svc.cluster.local:9000` | 10 GiB | `rustfs-auth`, keys `access-key` and `secret-key` |

Redis uses AOF with one-second fsync and `noeviction` for BullMQ. Its 256 MiB
`maxmemory` leaves space below the 1 GiB container limit for Redis overhead and
persistence. Writes fail when Redis reaches that threshold; monitor queue growth
before increasing it. Local-path volume sizes are requests, not enforced disk
quotas.

## Bootstrap

Check `kubectl config current-context` before changing cluster resources. Argo CD
must already be installed in `argocd`.

Create namespaces and credentials **before pushing these manifests to `main`**.
The existing root Application automatically syncs from GitHub, not your working
tree. These public example credentials match the app `.env.example` files and
are only for this local cluster. Never use them on a shared or public deployment,
and never commit real credentials or exported Secret YAML.

```sh
for namespace in postgres redis rustfs; do
  kubectl create namespace "$namespace" --dry-run=client -o yaml | kubectl apply -f -
done

kubectl -n postgres create secret generic postgres-auth \
  --from-literal=password=mercel-local-secret
kubectl -n redis create secret generic redis-auth \
  --from-literal=password=mercel-local-secret
kubectl -n rustfs create secret generic rustfs-auth \
  --from-literal=access-key=mercel-local \
  --from-literal=secret-key=mercel-local-secret
```

Run secret creation once. It refuses to overwrite existing secrets. Missing
secrets intentionally block pod startup. If you already generated credentials
with the previous instructions, keep using those values in your `.env` files;
updating examples does not change existing secrets. PostgreSQL reads its initial
password only when initializing an empty volume; changing its Secret alone does
not rotate the database password.

Commit and push `infra/` to `main`. If the root Application is not installed yet:

```sh
kubectl apply -f infra/envs/default/default.yaml
```

After Argo CD syncs, check the applications and wait for their pods:

```sh
kubectl get applications -n argocd
for app in postgres redis rustfs; do
  kubectl -n "$app" rollout status "statefulset/$app" --timeout=300s
  kubectl -n "$app" get pvc
done
```

## Connect host apps

Run each port-forward in a separate terminal. These host ports match the
`.env.example` files and avoid common local database and S3 ports.

```sh
kubectl -n postgres port-forward svc/postgres 15432:5432
kubectl -n redis port-forward svc/redis 16379:6379
kubectl -n rustfs port-forward svc/rustfs 19000:9000 19001:9001
```

The app and database `.env.example` files use these k3d port-forwards. Copy
examples to gitignored `.env` files if needed, without overwriting existing
files. Existing `.env` files need their relevant URLs updated to:

```dotenv
DATABASE_URL=postgresql://mercel:mercel-local-secret@127.0.0.1:15432/mercel
REDIS_URL=redis://default:mercel-local-secret@127.0.0.1:16379
S3_ENDPOINT=http://127.0.0.1:19000
S3_BUCKET=mercel
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=mercel-local
AWS_SECRET_ACCESS_KEY=mercel-local-secret
```

These values assume the local example credentials from bootstrap. For an
existing cluster with different credentials, use its Secret values instead.
GitHub OAuth and OpenCode API keys still need real credentials; their example
values remain blank.

Open `http://localhost:19001`, sign in with access key `mercel-local` and secret
key `mercel-local-secret`, and create the private `mercel` bucket. Bucket
creation is a one-time manual step.

Run `bun run db:migrate`, then `bun run dev`. Keep port-forwards running. Host
processes cannot use cluster DNS names; apps moved into Kubernetes should use the
internal endpoints in the table instead.

These services start with empty data. Existing Docker volumes are not imported
automatically. PostgreSQL and RustFS connections inside this local cluster are
not configured for TLS; do not expose these Services publicly.

## Validate manifest changes

Run from the repository root with a reachable Kubernetes API and the Argo CD CRD
installed. Server-side dry runs validate schemas without deploying resources.
The `default` namespace below avoids creating the target namespaces just for
validation.

```sh
(
  set -eu
  kubectl apply --dry-run=server --validate=strict -f infra/envs/default/apps
  for app in postgres redis rustfs; do
    kubectl apply --dry-run=server --validate=strict -n default -f "infra/workloads/$app"
  done
)
```

PVCs survive StatefulSet deletion and scale-down. Deleting a namespace, PVC, or
k3d cluster can still destroy its data. Retention is not a backup. Before using
this outside local development, add backups, TLS, network isolation, managed
secret storage, and a storage class suitable for the target cluster.
