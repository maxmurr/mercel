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
tree. Never commit generated credentials or exported Secret YAML.

```sh
for namespace in postgres redis rustfs; do
  kubectl create namespace "$namespace" --dry-run=client -o yaml | kubectl apply -f -
done

kubectl -n postgres create secret generic postgres-auth \
  --from-literal=password="$(openssl rand -hex 24)"
kubectl -n redis create secret generic redis-auth \
  --from-literal=password="$(openssl rand -hex 24)"
kubectl -n rustfs create secret generic rustfs-auth \
  --from-literal=access-key="$(openssl rand -hex 12)" \
  --from-literal=secret-key="$(openssl rand -hex 24)"
```

Run secret creation once. It refuses to overwrite existing secrets. Missing
secrets intentionally block pod startup instead of falling back to default
passwords. PostgreSQL reads its initial password only when initializing an empty
volume; changing its Secret alone does not rotate the database password.

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

Run each port-forward in a separate terminal. Alternate host ports avoid
conflicts with the existing Compose services, which remain untouched.

```sh
kubectl -n postgres port-forward svc/postgres 15432:5432
kubectl -n redis port-forward svc/redis 16379:6379
kubectl -n rustfs port-forward svc/rustfs 19000:9000 19001:9001
```

Read credentials locally with `kubectl get secret`. For example:

```sh
kubectl -n postgres get secret postgres-auth -o jsonpath='{.data.password}' | base64 -d; echo
```

Use the same command with the namespace, Secret name, and key from the table for
Redis and RustFS. The output is sensitive; do not paste it into chat or logs.

Update the relevant gitignored `.env` files under `apps/` and `packages/db/`:

```dotenv
DATABASE_URL=postgresql://mercel:<postgres-password>@127.0.0.1:15432/mercel
REDIS_URL=redis://default:<redis-password>@127.0.0.1:16379
S3_ENDPOINT=http://127.0.0.1:19000
S3_BUCKET=mercel
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<rustfs-access-key>
AWS_SECRET_ACCESS_KEY=<rustfs-secret-key>
```

Replace placeholders with the Secret values. Open `http://localhost:19001`, sign
in with the RustFS access/secret keys, and create the private `mercel` bucket.
Bucket creation is a one-time manual step, matching the Compose setup.

Run `bun run db:migrate`, then `bun run dev`. Keep port-forwards running. Host
processes cannot use cluster DNS names; apps moved into Kubernetes should use the
internal endpoints in the table instead.

These services start with empty data. Compose volumes do not migrate
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
